#!/bin/bash
cd /d/Ai_Web_dev_agent
node server.js &
SERVER_PID=$!
sleep 3
echo "Running tests..."
node test-server.js
kill $SERVER_PID 2>/dev/null || true
