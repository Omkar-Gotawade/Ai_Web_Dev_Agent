# AI Web Development Backend

A Node.js Express backend server that uses Google Gemini API to generate complete website code from natural language prompts.

## Features

- 🤖 **Gemini AI Integration** - Uses Google's Gemini Pro model
- 🚀 **Express Server** - RESTful API with CORS support
- 📁 **File Generation** - Automatically creates HTML, CSS, and JS files
- 🛡️ **Error Handling** - Robust error handling and validation
- 📝 **JSON Response** - Clean JSON parsing from AI responses

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Add your Google Gemini API key:

```env
GEMINI_API_KEY=your_actual_api_key_here
```

**Get your API key:** https://makersuite.google.com/app/apikey

### 3. Start the Server

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

The server will start on `http://localhost:5000`

## API Endpoints

### GET `/`
Health check endpoint.

**Response:**
```json
{
  "message": "Server running"
}
```

### POST `/generate`
Generate website code from a prompt.

**Request Body:**
```json
{
  "prompt": "Create a simple landing page with a hero section"
}
```

**Response:**
```json
{
  "success": true,
  "filesCreated": 3,
  "files": ["index.html", "styles.css", "script.js"]
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Error message here"
}
```

## Usage Example

### Using cURL

```bash
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a simple landing page"}'
```

### Using JavaScript Fetch

```javascript
const response = await fetch('http://localhost:5000/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'Create a portfolio website with about and contact sections'
  })
});

const data = await response.json();
console.log(data);
```

## Generated Files

All generated files are saved in the `workspace/` directory, which is automatically created if it doesn't exist.

Example structure:
```
workspace/
├── index.html
├── styles.css
└── script.js
```

## How It Works

1. **User sends prompt** to `/generate` endpoint
2. **Server forwards prompt** to Gemini API with system instructions
3. **Gemini generates** complete website code in JSON format
4. **Server parses** and validates the JSON response
5. **Files are created** in the `workspace/` directory
6. **Success response** sent back to user

## Error Handling

The server handles various error scenarios:

- Missing or invalid prompt
- Gemini API errors
- JSON parsing errors
- File system errors
- Invalid response structure

All errors are logged to console and returned as JSON responses.

## Technologies Used

- **Node.js** - JavaScript runtime
- **Express.js** - Web framework
- **Google Gemini AI** - AI code generation
- **CORS** - Cross-origin resource sharing
- **dotenv** - Environment variable management

## Requirements

- Node.js 18 or higher
- Google Gemini API key

## License

ISC
