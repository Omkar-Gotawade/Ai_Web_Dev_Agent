import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// System instruction for Gemini
const SYSTEM_INSTRUCTION = `You are an AI coding agent.

You can use these tools:
- list_files
- read_file
- write_file

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
- Prefer modifying existing files unless user clearly asks to create something new`;

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
 * Clear workspace folder and recreate it for fresh project generation.
 */
async function clearWorkspace() {
  console.log(`🧹 Clearing workspace at ${WORKSPACE_DIR}...`);

  try {
    await fs.promises.rm(WORKSPACE_DIR, { recursive: true, force: true });
    await ensureWorkspaceDirectory();
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
 * @returns {Promise<string>} - Raw response from Gemini
 */
async function generateAgentActions(prompt, mode, context) {
  try {
    console.log('📤 Sending agent prompt to Gemini:', prompt);

    const contextSection = context.fileContents
      .map((file) => `--- ${file.path} ---\n${file.content}`)
      .join('\n\n');

    const fullPrompt = `${SYSTEM_INSTRUCTION}

Current project files:
${JSON.stringify(context.files, null, 2)}

File contents:
${contextSection || '(No readable files yet)'}

User Request:
${prompt}

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

    // Generate actions using Gemini
    const rawResponse = await generateAgentActions(prompt, mode, context);

    // Clean and parse JSON response
    const cleanedResponse = cleanJsonResponse(rawResponse);

    let parsedResponse;
    try {
      parsedResponse = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error('❌ JSON parsing error:', parseError);
      console.error('Raw response:', rawResponse);

      return res.status(500).json({
        success: false,
        error: 'Failed to parse Gemini response as JSON',
        details: parseError.message,
        rawResponse: cleanedResponse.substring(0, 500) // First 500 chars for debugging
      });
    }

    // Validate response structure
    if (!parsedResponse.actions || !Array.isArray(parsedResponse.actions)) {
      return res.status(500).json({
        success: false,
        error: 'Invalid response structure from Gemini',
        details: 'Expected "actions" array in response'
      });
    }

    console.log(`📝 Parsed ${parsedResponse.actions.length} actions from response`);

    let actionsExecuted = 0;
    const actionResults = [];

    // Execute returned actions
    for (const action of parsedResponse.actions) {
      if (!action || typeof action !== 'object' || !action.type) {
        throw new Error('Invalid action entry: missing action type');
      }

      console.log('⚙️ Executing action:', action.type, action.path || action.directory || '');

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

      throw new Error(`Unsupported action type: ${action.type}`);
    }

    console.log('✨ Agent execution complete!');
    console.log(`Executed ${actionsExecuted} actions`);

    // Return success response
    res.json({
      success: true,
      actionsExecuted,
      actions: actionResults,
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
app.listen(PORT, () => {
  console.log('🚀 Server started successfully!');
  console.log(`📡 Server is running on http://localhost:${PORT}`);
  console.log(`🔑 Gemini API Key configured: ${process.env.GEMINI_API_KEY ? 'Yes' : 'No'}`);

  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  WARNING: GEMINI_API_KEY is not set in environment variables!');
    console.warn('⚠️  Create a .env file with your API key');
  }

  console.log('\n📝 Available endpoints:');
  console.log('  GET  / - Health check');
  console.log('  POST /generate - Execute coding agent actions');
  console.log(`📂 Workspace directory: ${WORKSPACE_DIR}`);
  console.log('\n💡 Ready to execute agent actions!');
});
