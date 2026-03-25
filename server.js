import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

// Initialize environment variables
dotenv.config();

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const PORT = 5000;
const WORKSPACE_DIR = path.join(__dirname, 'workspace');
const DEBUG_AGENT_LOGS = process.env.DEBUG_AGENT_LOGS === 'true';
const MAX_SELF_HEAL_RETRIES = 3;
const MAX_VALIDATION_RETRIES = 2;
const AUTO_INSTALL_ON_REACT_CREATE = true;
const REACT_PREVIEW_PORT = 5174;
const execAsync = promisify(exec);
let ACTIVE_PORT = PORT;
let reactPreviewProcess = null;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Base system instruction for Gemini
const BASE_SYSTEM_INSTRUCTION = `You are an AI coding agent.

You can use these tools:
- list_files
- read_file
- write_file
- run_command
- preview_project

You must decide whether to:
- create a new project (from scratch)
- or modify existing files

If creating a new project, assume workspace is empty.

You MUST return ONLY valid JSON in this format:

{
  "actions": [
    {
      "type": "write_file",
      "path": "index.html",
      "content": "<html>...</html>"
    }
  ]
}

Rules:
- No explanations
- No markdown
- Only JSON
- Prefer modifying existing files unless user clearly asks to create something new
- If a command fails, update files to fix the error and retry
- If user asks to preview, use preview_project`;

/**
 * Detect project type from prompt.
 * @param {string} prompt
 * @returns {'react' | 'static'}
 */
function detectProjectType(prompt) {
  const normalizedPrompt = String(prompt || '').toLowerCase();
  const reactKeywords = ['react', 'next', 'frontend app'];
  const isReact = reactKeywords.some((keyword) => normalizedPrompt.includes(keyword));
  return isReact ? 'react' : 'static';
}

/**
 * Build strict, type-specific system instructions.
 * @param {'react' | 'static'} projectType
 * @returns {string}
 */
function buildSystemInstruction(projectType) {
  const staticInstruction = `

Project type: static website.

You MUST ALWAYS generate exactly these required website files using write_file actions:
- index.html
- style.css
- script.js

Static website rules:
- index.html must link style.css
- index.html must include script.js
- Do NOT skip any required file
- Ensure a complete working website
- Build a professional, production-like design (not a minimal starter)
- Include clear page structure with navbar, hero, multiple content sections, and footer
- Make layout responsive for desktop, tablet, and mobile
- Use rich visual styling (spacing system, typography hierarchy, cards/grids, hover states)
- Add interactive behaviors with JavaScript (buttons, toggles, tabs, or similar)
- Include at least one form with client-side validation feedback`;

  const reactInstruction = `

Project type: react app.

You MUST ALWAYS generate a complete runnable project with write_file actions for:
- package.json
- index.html
- src/main.js (or src/index.js)
- src/App.js

React rules:
- package.json must include scripts: dev and build
- Include dependencies for react and react-dom and a dev workflow such as vite
- Project must run with npm install and npm run dev
- Do NOT return partial React code
- Build a professional, production-like interface (not a minimal demo)
- Include navbar, hero, multiple sections, and footer in the rendered experience
- Ensure responsive design for desktop/tablet/mobile
- Include meaningful interactive features (forms, validation, and button-driven UI state)
- Use clean structure with reusable React components (prefer src/components/* when helpful)
- Keep styles separated from logic (App.css and/or component-level css files)`;

  return `${BASE_SYSTEM_INSTRUCTION}${projectType === 'react' ? reactInstruction : staticInstruction}`;
}

/**
 * Get required files for a project type.
 * @param {'react' | 'static'} projectType
 * @returns {{requiredPaths: string[], requiresMainOrIndexInSrc: boolean}}
 */
function getRequiredProjectFiles(projectType) {
  if (projectType === 'react') {
    return {
      requiredPaths: ['package.json', 'index.html'],
      requiresMainOrIndexInSrc: true,
    };
  }

  return {
    requiredPaths: ['index.html', 'style.css', 'script.js'],
    requiresMainOrIndexInSrc: false,
  };
}

/**
 * Validate generated actions include required files for the target project type.
 * @param {Array<any>} actions
 * @param {'react' | 'static'} projectType
 * @returns {{valid: boolean, missingFiles: string[]}}
 */
function validateProject(actions, projectType) {
  const writePaths = new Set(
    (actions || [])
      .filter((action) => action?.type === 'write_file' && typeof action.path === 'string')
      .map((action) => action.path.replaceAll('\\', '/').toLowerCase())
  );

  const { requiredPaths, requiresMainOrIndexInSrc } = getRequiredProjectFiles(projectType);
  const missingFiles = requiredPaths.filter((requiredPath) => !writePaths.has(requiredPath));

  if (projectType === 'react' && requiresMainOrIndexInSrc) {
    const hasAppComponent =
      writePaths.has('src/app.js') ||
      writePaths.has('src/app.jsx') ||
      writePaths.has('src/app.ts') ||
      writePaths.has('src/app.tsx');

    const hasMainOrIndex =
      writePaths.has('src/main.js') ||
      writePaths.has('src/main.jsx') ||
      writePaths.has('src/main.ts') ||
      writePaths.has('src/main.tsx') ||
      writePaths.has('src/index.js') ||
      writePaths.has('src/index.jsx') ||
      writePaths.has('src/index.ts') ||
      writePaths.has('src/index.tsx');

    if (!hasAppComponent) {
      missingFiles.push('src/App.(js|jsx|ts|tsx)');
    }

    if (!hasMainOrIndex) {
      missingFiles.push('src/main.(js|jsx|ts|tsx) or src/index.(js|jsx|ts|tsx)');
    }
  }

  return {
    valid: missingFiles.length === 0,
    missingFiles,
  };
}

/**
 * Build strict retry guidance for missing required files.
 * @param {'react' | 'static'} projectType
 * @returns {string}
 */
function buildRequiredFilesHint(projectType) {
  if (projectType === 'react') {
    return `Required files to include as write_file actions: package.json, index.html, one App component file (src/App.js or src/App.jsx or src/App.tsx), and one entry file (src/main.js or src/main.jsx or src/index.js). package.json must include dev and build scripts with react/react-dom dependencies. Ensure production-like UI quality with navbar, hero, footer, multiple sections, responsive behavior, and interactive form validation.`;
  }

  return 'Required files to include as write_file actions: index.html, style.css, script.js. index.html must link style.css and include script.js. Ensure production-like UI quality with navbar, hero, footer, multiple sections, responsive behavior, and interactive form validation.';
}

/**
 * Detect whether prompt is asking for create or edit mode.
 * @param {string} prompt
 * @returns {'create' | 'edit'}
 */
function detectMode(prompt) {
  const normalizedPrompt = prompt.toLowerCase();
  const createKeywords = ['create', 'build', 'make', 'generate', 'new'];
  const isCreate = createKeywords.some((keyword) => {
    const keywordRegex = new RegExp(`\\b${keyword}\\b`, 'i');
    return keywordRegex.test(normalizedPrompt);
  });

  return isCreate ? 'create' : 'edit';
}

/**
 * Wait helper for retry flows.
 * @param {number} ms
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether filesystem error is typically transient on Windows.
 * @param {any} error
 * @returns {boolean}
 */
function isRetriableFsError(error) {
  const retriableCodes = new Set(['EBUSY', 'EPERM', 'ENOTEMPTY']);
  return Boolean(error?.code && retriableCodes.has(error.code));
}

/**
 * Best-effort stop of processes listening on the React preview port.
 */
async function stopPreviewPortListeners() {
  try {
    if (process.platform === 'win32') {
      const psCommand = `Get-NetTCPConnection -LocalPort ${REACT_PREVIEW_PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }`;
      await execAsync(`powershell -NoProfile -Command "${psCommand}"`, { windowsHide: true });
      return;
    }

    await execAsync(`lsof -ti tcp:${REACT_PREVIEW_PORT} | xargs -r kill -9`, { windowsHide: true });
  } catch {
    // Ignore cleanup failures; this is best-effort.
  }
}

/**
 * Clear workspace folder and recreate it for fresh project generation.
 */
async function clearWorkspace() {
  console.log(`🧹 Clearing workspace at ${WORKSPACE_DIR}...`);

  try {
    stopReactPreviewServer();
    await stopPreviewPortListeners();
    await ensureWorkspaceDirectory();

    const entries = await fs.promises.readdir(WORKSPACE_DIR, { withFileTypes: true });
    const failedEntries = [];

    for (const entry of entries) {
      const targetPath = path.join(WORKSPACE_DIR, entry.name);
      let removed = false;

      for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
          await fs.promises.rm(targetPath, {
            recursive: true,
            force: true,
            maxRetries: 5,
            retryDelay: 200,
          });
          removed = true;
          break;
        } catch (error) {
          if (!isRetriableFsError(error) || attempt === 4) {
            failedEntries.push({ name: entry.name, code: error.code || 'UNKNOWN' });
            break;
          }

          await delay(250 * attempt);
        }
      }

      if (!removed) {
        console.warn(`⚠️ Could not remove workspace entry: ${entry.name}`);
      }
    }

    if (failedEntries.length > 0) {
      const failedText = failedEntries
        .map((item) => `${item.name} (${item.code})`)
        .join(', ')
        .slice(0, 500);
      throw new Error(`Workspace contains locked entries: ${failedText}`);
    }

    console.log('✅ Workspace cleared and recreated');
  } catch (error) {
    console.error('❌ Failed to clear workspace:', error);
    throw new Error(`Failed to clear workspace: ${error.message}`);
  }
}

/**
 * Ensure workspace directory exists.
 */
async function ensureWorkspaceDirectory() {
  await fs.promises.mkdir(WORKSPACE_DIR, { recursive: true });
}

/**
 * Resolve a workspace-relative path safely.
 * @param {string} relativePath
 * @returns {string}
 */
function resolveWorkspacePath(relativePath = '') {
  const targetPath = path.resolve(WORKSPACE_DIR, relativePath);
  const workspaceRoot = path.resolve(WORKSPACE_DIR);

  if (targetPath !== workspaceRoot && !targetPath.startsWith(`${workspaceRoot}${path.sep}`)) {
    throw new Error(`Path is outside workspace: ${relativePath}`);
  }

  return targetPath;
}

/**
 * Recursively list files in workspace.
 * @param {string} directory
 * @returns {Promise<string[]>}
 */
async function listFiles(directory = '') {
  await ensureWorkspaceDirectory();

  const startPath = resolveWorkspacePath(directory);
  const result = [];

  async function walk(currentPath) {
    let entries;
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else {
        const relative = path.relative(WORKSPACE_DIR, fullPath).replaceAll('\\', '/');
        result.push(relative);
      }
    }
  }

  await walk(startPath);
  result.sort();
  return result;
}

/**
 * Read a file from workspace.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function readFile(filePath) {
  const targetPath = resolveWorkspacePath(filePath);

  try {
    return await fs.promises.readFile(targetPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw new Error(`Failed to read file ${filePath}: ${error.message}`);
  }
}

/**
 * Write a file into workspace.
 * @param {string} filePath
 * @param {string} content
 */
async function writeFile(filePath, content) {
  const targetPath = resolveWorkspacePath(filePath);
  const dirPath = path.dirname(targetPath);

  await fs.promises.mkdir(dirPath, { recursive: true });
  await fs.promises.writeFile(targetPath, content, 'utf8');
}

/**
 * Check whether a workspace-relative path exists.
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
async function workspacePathExists(relativePath) {
  const targetPath = resolveWorkspacePath(relativePath);
  try {
    await fs.promises.access(targetPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a process is still alive.
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessRunning(pid) {
  if (!pid || Number.isNaN(pid)) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stop background React preview process if active.
 */
function stopReactPreviewServer() {
  if (!reactPreviewProcess?.pid) {
    return;
  }

  if (isProcessRunning(reactPreviewProcess.pid)) {
    try {
      process.kill(reactPreviewProcess.pid);
      console.log(`🛑 Stopped React preview process (PID: ${reactPreviewProcess.pid})`);
    } catch (error) {
      console.warn('⚠️ Unable to stop React preview process:', error.message || error);
    }
  }

  reactPreviewProcess = null;
}

/**
 * Start React preview server (Vite) in workspace and return preview URL.
 * @returns {Promise<{success: boolean, url?: string, error?: string}>}
 */
async function startReactPreviewServer() {
  await ensureWorkspaceDirectory();

  if (reactPreviewProcess?.pid && isProcessRunning(reactPreviewProcess.pid)) {
    return {
      success: true,
      url: `http://localhost:${REACT_PREVIEW_PORT}`,
    };
  }

  const hasPackageJson = await workspacePathExists('package.json');
  if (!hasPackageJson) {
    return {
      success: false,
      error: 'React preview failed: package.json not found in workspace.',
    };
  }

  const hasNodeModules = await workspacePathExists('node_modules');
  if (!hasNodeModules) {
    console.log('📦 Installing dependencies before preview: npm install');
    const installResult = await runCommand('npm install');
    if (!installResult.success) {
      return {
        success: false,
        error: installResult.stderr || installResult.error || 'npm install failed before preview.',
      };
    }
  }

  const previewProcess = process.platform === 'win32'
    ? spawn(
      'cmd.exe',
      ['/c', `npm run dev -- --host 127.0.0.1 --port ${REACT_PREVIEW_PORT} --strictPort`],
      {
        cwd: WORKSPACE_DIR,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }
    )
    : spawn(
      'npm',
      ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(REACT_PREVIEW_PORT), '--strictPort'],
      {
        cwd: WORKSPACE_DIR,
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
      }
    );

  const startup = await new Promise((resolve) => {
    let settled = false;

    const complete = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    previewProcess.once('error', (error) => {
      complete({ success: false, error: error.message || 'Failed to start React preview server.' });
    });

    previewProcess.once('exit', (code) => {
      complete({ success: false, error: `React preview server exited early with code ${code}.` });
    });

    setTimeout(() => {
      complete({ success: true });
    }, 2500);
  });

  if (!startup.success) {
    return startup;
  }

  previewProcess.unref();
  reactPreviewProcess = { pid: previewProcess.pid };
  return {
    success: true,
    url: `http://localhost:${REACT_PREVIEW_PORT}`,
  };
}

/**
 * Resolve preview URL automatically after action execution.
 * @param {'react' | 'static'} projectType
 * @returns {Promise<string>}
 */
async function getAutoPreviewUrl(projectType) {
  if (projectType === 'react') {
    const reactPreview = await startReactPreviewServer();
    if (!reactPreview.success || !reactPreview.url) {
      throw new Error(reactPreview.error || 'Failed to start React preview server');
    }
    return reactPreview.url;
  }

  await ensureWorkspaceDirectory();
  return `http://localhost:${ACTIVE_PORT}/preview`;
}

/**
 * Execute a shell command in workspace and capture stdout/stderr.
 * @param {string} command
 * @returns {Promise<{success: boolean, stdout: string, stderr: string, error: string | null}>}
 */
async function runCommand(command) {
  await ensureWorkspaceDirectory();
  console.log(`🖥️ Running command: ${command}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: WORKSPACE_DIR,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const cleanedStdout = stdout?.trim() || '';
    const cleanedStderr = stderr?.trim() || '';
    const success = true;

    return {
      success,
      stdout: cleanedStdout,
      stderr: cleanedStderr,
      error: null,
    };
  } catch (error) {
    return {
      success: false,
      stdout: (error.stdout || '').trim(),
      stderr: (error.stderr || '').trim(),
      error: error.message,
    };
  }
}

/**
 * Run deterministic post-create setup commands.
 * @param {'react' | 'static'} projectType
 * @param {'create' | 'edit'} mode
 * @returns {Promise<{actionsExecuted: number, actionResults: Array<any>}>}
 */
async function runPostCreateSetup(projectType, mode) {
  if (!AUTO_INSTALL_ON_REACT_CREATE || mode !== 'create' || projectType !== 'react') {
    return { actionsExecuted: 0, actionResults: [] };
  }

  console.log('📦 Running post-create setup: npm install');
  const installResult = await runCommand('npm install');
  const output = [installResult.stdout, installResult.stderr, installResult.error]
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);

  const actionResult = {
    type: 'run_command',
    command: 'npm install',
    auto: true,
    success: installResult.success,
    output,
  };

  if (installResult.success) {
    console.log('✅ Post-create setup complete: npm install');
  } else {
    console.warn('⚠️ Post-create setup failed: npm install');
  }

  return {
    actionsExecuted: 1,
    actionResults: [actionResult],
  };
}

/**
 * Build context from existing workspace files.
 * @returns {Promise<{files: string[], fileContents: Array<{path: string, content: string}>}>}
 */
async function gatherWorkspaceContext() {
  const files = await listFiles();
  const importantFiles = ['index.html', 'style.css', 'styles.css', 'script.js'];

  const selectedFiles = importantFiles.filter((file) => files.includes(file));
  if (selectedFiles.length === 0) {
    selectedFiles.push(...files.slice(0, 3));
  }

  const fileContents = [];
  for (const file of selectedFiles) {
    try {
      const content = await readFile(file);
      fileContents.push({
        path: file,
        content: content.slice(0, 6000),
      });
    } catch (error) {
      console.warn(`⚠️ Unable to read context file ${file}:`, error.message);
    }
  }

  return { files, fileContents };
}

/**
 * Generate agent actions using Gemini API
 * @param {string} prompt - User request
 * @param {'create' | 'edit'} mode
 * @param {{files: string[], fileContents: Array<{path: string, content: string}>}} context
 * @param {{projectType?: 'react' | 'static', enforceCompleteness?: boolean}} options
 * @returns {Promise<string>} - Raw response from Gemini
 */
async function generateAgentActions(prompt, mode, context, options = {}) {
  try {
    console.log('📤 Sending agent prompt to Gemini:', prompt);

    const projectType = options.projectType || detectProjectType(prompt);
    const enforceCompleteness = options.enforceCompleteness !== false;
    const systemInstruction = buildSystemInstruction(projectType);
    const strictCompletenessInstruction = enforceCompleteness
      ? `For this request, you MUST create a complete ${projectType} project with all required files. Do not skip any required files. Output must look production-like, include navbar/hero/footer, include multiple sections, be responsive, and include interactive behaviors.`
      : '';

    const contextSection = context.fileContents
      .map((file) => `--- ${file.path} ---\n${file.content}`)
      .join('\n\n');

    const fullPrompt = `${systemInstruction}

Current project files:
${JSON.stringify(context.files, null, 2)}

File contents:
${contextSection || '(No readable files yet)'}

User Request:
${prompt}

${strictCompletenessInstruction}

Request Mode:
${mode}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('📥 Received response from Gemini');
    if (DEBUG_AGENT_LOGS) {
      console.log('Response length:', text.length);
      console.log('🧾 Raw AI response:', text);
    }

    return text;
  } catch (error) {
    console.error('❌ Error generating actions with Gemini:', error);
    throw new Error(`Gemini API error: ${error.message}`);
  }
}

/**
 * Parse and validate model JSON output.
 * @param {string} rawResponse
 * @returns {{actions: Array<any>}}
 */
function parseAgentResponse(rawResponse) {
  const cleanedResponse = cleanJsonResponse(rawResponse);

  let parsedResponse;
  try {
    parsedResponse = JSON.parse(cleanedResponse);
  } catch (parseError) {
    throw new Error(`Failed to parse Gemini response as JSON: ${parseError.message}`);
  }

  if (!parsedResponse.actions || !Array.isArray(parsedResponse.actions)) {
    throw new Error('Invalid response structure from Gemini: expected "actions" array');
  }

  return parsedResponse;
}

/**
 * Apply a list of agent actions.
 * @param {Array<any>} actions
 * @param {{allowRunCommand: boolean, projectType?: 'react' | 'static', prompt?: string}} options
 * @returns {Promise<{actionsExecuted: number, actionResults: Array<any>, commandFailures: Array<any>}>
 */
async function executeActions(actions, options = { allowRunCommand: true, projectType: 'static', prompt: '' }) {
  let actionsExecuted = 0;
  const actionResults = [];
  const commandFailures = [];

  for (const action of actions) {
    if (!action || typeof action !== 'object' || !action.type) {
      throw new Error('Invalid action entry: missing action type');
    }

    console.log('⚙️ Executing action:', action.type, action.path || action.directory || action.command || '');

    if (action.type === 'write_file') {
      if (typeof action.path !== 'string' || typeof action.content !== 'string') {
        throw new Error('write_file action requires string "path" and "content"');
      }

      await writeFile(action.path, action.content);
      actionResults.push({ type: action.type, path: action.path });
      actionsExecuted += 1;
      continue;
    }

    if (action.type === 'read_file') {
      if (typeof action.path !== 'string') {
        throw new Error('read_file action requires string "path"');
      }

      const content = await readFile(action.path);
      actionResults.push({
        type: action.type,
        path: action.path,
        contentLength: content.length,
      });
      actionsExecuted += 1;
      continue;
    }

    if (action.type === 'list_files') {
      const directory = typeof action.directory === 'string' ? action.directory : '';
      const files = await listFiles(directory);
      actionResults.push({
        type: action.type,
        directory,
        fileCount: files.length,
      });
      actionsExecuted += 1;
      continue;
    }

    if (action.type === 'run_command') {
      if (!options.allowRunCommand) {
        throw new Error('run_command is not allowed in this execution context');
      }

      if (typeof action.command !== 'string' || action.command.trim() === '') {
        throw new Error('run_command action requires non-empty string "command"');
      }

      const commandResult = await runCommand(action.command);
      const output = [commandResult.stdout, commandResult.stderr, commandResult.error]
        .filter(Boolean)
        .join('\n')
        .slice(0, 4000);

      actionResults.push({
        type: action.type,
        command: action.command,
        success: commandResult.success,
        output,
      });
      actionsExecuted += 1;

      if (!commandResult.success) {
        commandFailures.push({
          command: action.command,
          ...commandResult,
        });
      }
      continue;
    }

    if (action.type === 'preview_project') {
      console.log('👀 Preview requested');
      const detectedProjectType = options.projectType || detectProjectType(options.prompt || '');
      console.log(`🧱 Project type: ${detectedProjectType}`);

      if (detectedProjectType === 'static') {
        await ensureWorkspaceDirectory();
        const previewUrl = `http://localhost:${ACTIVE_PORT}/preview`;
        console.log(`🔗 Preview URL: ${previewUrl}`);
        actionResults.push({ type: action.type, previewUrl, projectType: detectedProjectType });
        actionsExecuted += 1;
        continue;
      }

      const reactPreview = await startReactPreviewServer();
      if (!reactPreview.success) {
        throw new Error(reactPreview.error || 'React preview server failed to start');
      }

      const previewUrl = reactPreview.url;
      console.log(`🔗 Preview URL: ${previewUrl}`);
      actionResults.push({ type: action.type, previewUrl, projectType: detectedProjectType });
      actionsExecuted += 1;
      continue;
    }

    throw new Error(`Unsupported action type: ${action.type}`);
  }

  return { actionsExecuted, actionResults, commandFailures };
}

/**
 * Attempt auto-fixes for command failures by asking the model to patch files.
 * @param {Array<any>} commandFailures
 * @returns {Promise<{fixesApplied: number, retriesUsed: number}>}
 */
async function autoFixCommandFailures(commandFailures) {
  let fixesApplied = 0;
  let retriesUsed = 0;

  for (const failure of commandFailures) {
    let attempt = 0;
    let currentFailure = failure;

    while (attempt < MAX_SELF_HEAL_RETRIES && !currentFailure.success) {
      attempt += 1;
      retriesUsed += 1;

      const errorLogs = [
        `Command: ${currentFailure.command}`,
        currentFailure.stdout ? `STDOUT:\n${currentFailure.stdout}` : '',
        currentFailure.stderr ? `STDERR:\n${currentFailure.stderr}` : '',
        currentFailure.error ? `ERROR:\n${currentFailure.error}` : '',
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 12000);

      console.log(`❌ Command failed. Self-heal attempt ${attempt}/${MAX_SELF_HEAL_RETRIES}`);
      console.log(`🩺 Attempting fix for command: ${currentFailure.command}`);

      const fixPrompt = `Fix this error:\n${errorLogs}\n\nReturn write_file actions to fix the project files so the command succeeds.`;
      const context = await gatherWorkspaceContext();
      const rawFixResponse = await generateAgentActions(fixPrompt, 'edit', context, {
        projectType: 'static',
        enforceCompleteness: false,
      });
      const parsedFixResponse = parseAgentResponse(rawFixResponse);
      const fixActions = parsedFixResponse.actions.filter((action) => action?.type !== 'run_command');

      const fixExecution = await executeActions(fixActions, { allowRunCommand: false });
      fixesApplied += fixExecution.actionsExecuted;

      console.log(`🛠️ Fix actions applied: ${fixExecution.actionsExecuted}`);
      console.log(`🔁 Re-running command: ${currentFailure.command}`);

      currentFailure = {
        command: currentFailure.command,
        ...(await runCommand(currentFailure.command)),
      };

      if (currentFailure.success) {
        console.log('✅ Command recovered after self-healing');
        break;
      }
    }

    if (!currentFailure.success) {
      throw new Error(
        `Command failed after ${MAX_SELF_HEAL_RETRIES} retries: ${currentFailure.command}\n${currentFailure.stderr || currentFailure.error || ''}`
      );
    }
  }

  return { fixesApplied, retriesUsed };
}

/**
 * Clean response text to extract valid JSON
 * @param {string} text - Raw response text
 * @returns {string} - Cleaned JSON string
 */
function cleanJsonResponse(text) {
  // Remove markdown code blocks if present
  let cleaned = text.trim();

  // Remove ```json and ``` markers
  cleaned = cleaned.replace(/^```json\s*/i, '');
  cleaned = cleaned.replace(/^```\s*/, '');
  cleaned = cleaned.replace(/\s*```$/, '');

  // Trim again after removal
  cleaned = cleaned.trim();

  // Extract the first complete JSON object and ignore trailing junk.
  cleaned = extractFirstJsonObject(cleaned);

  if (DEBUG_AGENT_LOGS) {
    console.log('🧹 Cleaned response (first 200 chars):', cleaned.substring(0, 200));
  }

  return cleaned;
}

/**
 * Extract the first valid top-level JSON object from text.
 * Handles braces inside JSON strings correctly.
 * @param {string} text
 * @returns {string}
 */
function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) {
    throw new Error('No JSON object start found in model response');
  }

  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (escaping) {
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1).trim();
      }
    }
  }

  throw new Error('No complete JSON object found in model response');
}

// Routes

app.use('/preview', (req, res, next) => {
  ensureWorkspaceDirectory()
    .then(() => next())
    .catch((error) => next(error));
});

app.use('/preview', express.static(WORKSPACE_DIR, { index: 'index.html' }));

/**
 * Health check route
 */
app.get('/', (req, res) => {
  res.json({ message: 'Server running' });
});

/**
 * Agent endpoint
 */
app.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required and must be a non-empty string'
      });
    }

    console.log('🚀 Starting agent execution...');
    console.log('Prompt:', prompt);

    const mode = detectMode(prompt);
    console.log(`🧭 Detected mode: ${mode}`);

    const projectType = detectProjectType(prompt);
    console.log(`🧱 Detected project type: ${projectType}`);

    const filesBefore = await listFiles();
    console.log(`📊 Files before execution: ${filesBefore.length}`);

    if (mode === 'create') {
      await clearWorkspace();
    }

    const filesAfterModeHandling = await listFiles();
    console.log(`📊 Files after mode handling: ${filesAfterModeHandling.length}`);

    // Gather workspace context for agent
    const context = await gatherWorkspaceContext();
    console.log(`📁 Context files count: ${context.files.length}`);

    // Generate and validate actions using Gemini
    let parsedResponse;
    let generationPrompt = prompt;
    let validationAttempt = 0;

    while (validationAttempt <= MAX_VALIDATION_RETRIES) {
      const rawResponse = await generateAgentActions(generationPrompt, mode, context, {
        projectType,
        enforceCompleteness: true,
      });

      try {
        parsedResponse = parseAgentResponse(rawResponse);
      } catch (error) {
        console.error('❌ Response parsing/validation error:', error);

        if (validationAttempt === MAX_VALIDATION_RETRIES) {
          return res.status(500).json({
            success: false,
            error: error.message,
          });
        }

        validationAttempt += 1;
        console.log(`🔁 Parse retry attempt ${validationAttempt}/${MAX_VALIDATION_RETRIES}`);
        generationPrompt = `${prompt}\n\nYour previous output was invalid JSON. Return ONLY valid JSON with properly escaped file contents and all required files for a complete ${projectType} project.`;
        continue;
      }

      const validation = validateProject(parsedResponse.actions, projectType);
      if (validation.valid) {
        break;
      }

      console.warn(`⚠️ Project validation failed. Missing files: ${validation.missingFiles.join(', ')}`);

      if (validationAttempt === MAX_VALIDATION_RETRIES) {
        return res.status(500).json({
          success: false,
          error: `Project generation incomplete after ${MAX_VALIDATION_RETRIES} retries. Missing files: ${validation.missingFiles.join(', ')}`,
        });
      }

      validationAttempt += 1;
      console.log(`🔁 Validation retry attempt ${validationAttempt}/${MAX_VALIDATION_RETRIES}`);

      const requiredFilesHint = buildRequiredFilesHint(projectType);
      generationPrompt = `${prompt}\n\nYour previous output was incomplete. Missing files: ${validation.missingFiles.join(', ')}. Fix it and return complete project. ${requiredFilesHint}`;
    }

    console.log(`📝 Parsed ${parsedResponse.actions.length} actions from response`);

    const execution = await executeActions(parsedResponse.actions, {
      allowRunCommand: true,
      projectType,
      prompt,
    });

    let fixesApplied = 0;
    let retriesUsed = 0;

    if (execution.commandFailures.length > 0) {
      console.log(`🚨 Command failures detected: ${execution.commandFailures.length}`);
      const healing = await autoFixCommandFailures(execution.commandFailures);
      fixesApplied = healing.fixesApplied;
      retriesUsed = healing.retriesUsed;
    }

    const postCreateSetup = await runPostCreateSetup(projectType, mode);
    const totalActionsExecuted = execution.actionsExecuted + postCreateSetup.actionsExecuted;
    const allActionResults = [...execution.actionResults, ...postCreateSetup.actionResults];

    console.log('👀 Auto preview enabled');
    const previewUrl = await getAutoPreviewUrl(projectType);
    console.log(`🔗 Preview URL returned: ${previewUrl}`);

    console.log('✨ Agent execution complete!');
    console.log(`Executed ${totalActionsExecuted} actions`);
    if (retriesUsed > 0) {
      console.log(`🩺 Self-heal retries used: ${retriesUsed}`);
      console.log(`🛠️ Fix actions applied: ${fixesApplied}`);
    }

    // Return success response
    res.json({
      success: true,
      actionsExecuted: totalActionsExecuted,
      actions: allActionResults,
      retriesUsed,
      fixesApplied,
      previewUrl,
    });

  } catch (error) {
    console.error('❌ Error in /generate endpoint:', error);

    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

// Start server
function startServer(port) {
  const server = app.listen(port, () => {
    ACTIVE_PORT = port;
    console.log('🚀 Server started successfully!');
    console.log(`📡 Server is running on http://localhost:${port}`);
    console.log(`🔑 Gemini API Key configured: ${process.env.GEMINI_API_KEY ? 'Yes' : 'No'}`);

    if (!process.env.GEMINI_API_KEY) {
      console.warn('⚠️  WARNING: GEMINI_API_KEY is not set in environment variables!');
      console.warn('⚠️  Create a .env file with your API key');
    }

    console.log('\n📝 Available endpoints:');
    console.log('  GET  / - Health check');
    console.log('  POST /generate - Execute coding agent actions');
    console.log('  GET  /preview - Preview workspace output');
    console.log(`📂 Workspace directory: ${WORKSPACE_DIR}`);
    console.log('\n💡 Ready to execute agent actions!');
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      const nextPort = Number(port) + 1;
      console.warn(`⚠️  Port ${port} is in use. Retrying on port ${nextPort}...`);
      startServer(nextPort);
      return;
    }

    console.error('❌ Server failed to start:', error);
    process.exit(1);
  });
}

startServer(PORT);
