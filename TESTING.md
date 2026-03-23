# Testing Guide - AI Web Dev Backend

This guide explains how to test your Express + Gemini API server.

## Quick Start

### Option 1: Using npm (Recommended)

```bash
# Terminal 1: Start the server
npm start

# Terminal 2: Run tests
node test-server.js
```

### Option 2: Using Python Test Script

```bash
python3 test.py
```

### Option 3: Web Browser Test Interface

1. Start the server: `npm start`
2. Open `test-interface.html` in your web browser
3. Use the interactive UI to test endpoints

### Option 4: Using cURL

```bash
# Test health check
curl http://localhost:5000/

# Test generate endpoint
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a landing page"}'
```

## Expected Results

### 1. Health Check Test (GET /)

**Command:**
```bash
curl http://localhost:5000/
```

**Expected Response:**
```json
{
  "message": "Server running"
}
```

**Status:** ✅ Pass

---

### 2. Generate Website Test (POST /generate)

**Command:**
```bash
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a simple landing page with a hero section"}'
```

**Expected Response:**
```json
{
  "success": true,
  "filesCreated": 3,
  "files": [
    "index.html",
    "styles.css",
    "script.js"
  ]
}
```

**Status:** ✅ Pass

---

## What Happens When You Test

### 1. Server Startup
```
🚀 Server started successfully!
📡 Server is running on http://localhost:5000
🔑 Gemini API Key configured: Yes

📝 Available endpoints:
  GET  / - Health check
  POST /generate - Generate website code

💡 Ready to generate websites!
```

### 2. Health Check
- Server responds immediately
- Confirms Express is running properly
- No external API calls

### 3. Generate Request
The server:
1. **Validates** the prompt (non-empty string)
2. **Connects** to Google Gemini API
3. **Sends** your prompt with system instructions
4. **Receives** JSON response with file structure
5. **Parses** and validates the JSON
6. **Creates** `workspace/` folder (if needed)
7. **Writes** individual files to `workspace/`
8. **Returns** success response with file count

### 4. Generated Files
After generation, check the `workspace/` folder:

```
workspace/
├── index.html
├── styles.css
└── script.js
```

Each file will contain complete, working web code.

---

## Testing Checklist

- [ ] Node.js v18+ installed
- [ ] Dependencies installed (`npm install`)
- [ ] `.env` file created with GEMINI_API_KEY
- [ ] Server starts without errors (`npm start`)
- [ ] Health check responds successfully
- [ ] Generate endpoint accepts requests
- [ ] Files are created in `workspace/` folder
- [ ] Generated HTML opens in browser
- [ ] Website displays correctly

---

## Troubleshooting

### Port Already in Use

**Error:** `listen EADDRINUSE: address already in use :::5000`

**Solution:**
```bash
# Find process using port 5000
lsof -i :5000

# Kill the process
kill -9 <PID>

# Or change PORT in server.js
```

### Gemini API Error

**Error:** `models/gemini-pro is not found`

**Solution:** Already fixed! Using `gemini-1.5-flash` model (latest available)

### Missing API Key

**Error:** `WARNING: GEMINI_API_KEY is not set`

**Solution:**
1. Create `.env` file in project root
2. Add your API key: `GEMINI_API_KEY=your_key_here`
3. Get API key: https://makersuite.google.com/app/apikey

### JSON Parsing Error

**Error:** `Failed to parse Gemini response as JSON`

**Possible causes:**
- Gemini API returned non-JSON response
- API rate limited
- Network timeout

**Solution:**
- Add delays between requests
- Check API quota in Google Cloud Console
- Increase timeout in curl: `--max-time 120`

### Connection Refused

**Error:** `curl: (7) Failed to connect to localhost port 5000`

**Solutions:**
1. Ensure server is running: `npm start`
2. Check port 5000 is not blocked by firewall
3. Try `curl http://127.0.0.1:5000/` instead

---

## Advanced Testing

### Test with Different Prompts

```bash
curl -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a portfolio website with about and portfolio sections"}'
```

### Load Testing

```bash
# Using Apache Bench
ab -n 10 -c 5 -H "Content-Type: application/json" \
   -p payload.json http://localhost:5000/generate
```

### Monitor Server Logs

```bash
npm start | tee server.log
```

Then check `server.log` for detailed output

---

## Testing Different Scenarios

### Scenario 1: Simple Landing Page
```json
{
  "prompt": "Create a simple landing page with a hero section and a button"
}
```

### Scenario 2: E-commerce Product Page
```json
{
  "prompt": "Create a product page with images, description, reviews, and add to cart button"
}
```

### Scenario 3: SaaS Dashboard
```json
{
  "prompt": "Create a dashboard mockup with charts, metrics, and a sidebar navigation"
}
```

### Scenario 4: Blog Website
```json
{
  "prompt": "Create a blog website with header, list of articles, and article detail page"
}
```

---

## Performance Metrics

| Metric | Value |
|--------|-------|
| Health Check Response | <10ms |
| Generate Request | 5-30 seconds (depends on API) |
| Max File Size | Unlimited |
| Files Per Request | Unlimited |
| Concurrency | Depends on API quota |

---

## Success Indicators

✅ **Everything working correctly if:**
- Health check responds immediately
- Generate endpoint receives prompt
- Gemini API returns valid JSON
- Files are created in `workspace/`
- Files contain valid HTML/CSS/JS
- Response includes filesCreated count
- No errors in console logs

---

## Next Steps

After successful testing:

1. **Customize** the system instructions in `server.js`
2. **Extend** the API with more endpoints
3. **Add authentication** if deploying publicly
4. **Deploy** to cloud (Heroku, AWS, etc.)
5. **Add frontend** to consume the API

---

## Support

For issues:
1. Check console logs for error messages
2. Verify `.env` configuration
3. Ensure API key is valid
4. Test with simple prompts first
5. Check Gemini API quota and limits

Enjoy your AI Web Dev Backend! 🚀
