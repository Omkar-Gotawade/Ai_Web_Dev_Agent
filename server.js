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

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini API
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// System instruction for Gemini
const SYSTEM_INSTRUCTION = `You are a web developer AI.
You must return ONLY valid JSON in this exact format:

{
  "files": [
    {
      "path": "index.html",
      "content": "<html>...</html>"
    }
  ]
}

Rules:
- No markdown
- No explanations
- No extra text
- Only JSON output
- Generate complete, working code
- Use modern web development practices
- Include all necessary HTML, CSS, and JavaScript in appropriate files`;

/**
 * Generate website code using Gemini API
 * @param {string} prompt - User's prompt for website generation
 * @returns {Promise<string>} - Raw response from Gemini
 */
async function generateWebsiteCode(prompt) {
  try {
    console.log('📤 Sending prompt to Gemini:', prompt);

    const fullPrompt = `${SYSTEM_INSTRUCTION}\n\nUser Request: ${prompt}`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    console.log('📥 Received response from Gemini');
    console.log('Response length:', text.length);

    return text;
  } catch (error) {
    console.error('❌ Error generating content with Gemini:', error);
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

  console.log('🧹 Cleaned response (first 200 chars):', cleaned.substring(0, 200));

  return cleaned;
}

/**
 * Create directory recursively if it doesn't exist
 * @param {string} dirPath - Directory path to create
 */
function ensureDirectoryExists(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log('📁 Created directory:', dirPath);
  }
}

/**
 * Write files to the workspace directory
 * @param {Array} files - Array of file objects with path and content
 * @returns {number} - Number of files created
 */
function writeFilesToWorkspace(files) {
  const workspaceDir = path.join(__dirname, 'workspace');

  // Ensure workspace directory exists
  ensureDirectoryExists(workspaceDir);

  let filesCreated = 0;

  for (const file of files) {
    try {
      const filePath = path.join(workspaceDir, file.path);
      const fileDir = path.dirname(filePath);

      // Ensure the file's directory exists
      ensureDirectoryExists(fileDir);

      // Write the file
      fs.writeFileSync(filePath, file.content, 'utf8');
      console.log('✅ Created file:', file.path);

      filesCreated++;
    } catch (error) {
      console.error('❌ Error writing file:', file.path, error);
      throw new Error(`Failed to write file ${file.path}: ${error.message}`);
    }
  }

  return filesCreated;
}

// Routes

/**
 * Health check route
 */
app.get('/', (req, res) => {
  res.json({ message: 'Server running' });
});

/**
 * Generate website code endpoint
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

    console.log('🚀 Starting website generation...');
    console.log('Prompt:', prompt);

    // Generate code using Gemini
    const rawResponse = await generateWebsiteCode(prompt);

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
    if (!parsedResponse.files || !Array.isArray(parsedResponse.files)) {
      return res.status(500).json({
        success: false,
        error: 'Invalid response structure from Gemini',
        details: 'Expected "files" array in response'
      });
    }

    console.log(`📝 Parsed ${parsedResponse.files.length} files from response`);

    // Write files to workspace
    const filesCreated = writeFilesToWorkspace(parsedResponse.files);

    console.log('✨ Website generation complete!');
    console.log(`Created ${filesCreated} files in workspace/`);

    // Return success response
    res.json({
      success: true,
      filesCreated: filesCreated,
      files: parsedResponse.files.map(f => f.path)
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
  console.log('  POST /generate - Generate website code');
  console.log('\n💡 Ready to generate websites!');
});
