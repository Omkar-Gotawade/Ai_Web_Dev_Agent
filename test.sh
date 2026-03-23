#!/bin/bash

# AI Web Dev Backend - Comprehensive Test Suite
# Run this script to test all functionality

echo "🧪 Starting Comprehensive Test Suite..."
echo "========================================"

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Wait time for server startup
STARTUP_WAIT=3

echo -e "${YELLOW}[1/5]${NC} Checking Node.js...";
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js not found${NC}"
  exit 1
fi
NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js $NODE_VERSION found${NC}"

echo ""
echo -e "${YELLOW}[2/5]${NC} Checking dependencies...";
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  echo -e "${YELLOW}Installing npm packages...${NC}"
  npm install
fi
echo -e "${GREEN}✓ Dependencies ready${NC}"

echo ""
echo -e "${YELLOW}[3/5]${NC} Checking environment configuration...";
if [ -f ".env" ]; then
  if grep -q "GEMINI_API_KEY" .env; then
    echo -e "${GREEN}✓ .env file configured${NC}"
  else
    echo -e "${RED}✗ GEMINI_API_KEY not found in .env${NC}"
    exit 1
  fi
else
  echo -e "${RED}✗ .env file not found${NC}"
  exit 1
fi

echo ""
echo -e "${YELLOW}[4/5]${NC} Starting server...";
node server.js > /tmp/server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

sleep $STARTUP_WAIT

if ! kill -0 $SERVER_PID 2>/dev/null; then
  echo -e "${RED}✗ Server failed to start${NC}"
  cat /tmp/server.log
  exit 1
fi
echo -e "${GREEN}✓ Server started (PID: $SERVER_PID)${NC}"

echo ""
echo -e "${YELLOW}[5/5]${NC} Running endpoint tests...";

# Test 1: Health Check
echo ""
echo "Testing GET /"
HEALTH_RESPONSE=$(curl -s http://localhost:5000/)
if echo "$HEALTH_RESPONSE" | grep -q "Server running"; then
  echo -e "${GREEN}✓ Health check passed${NC}"
  echo "Response: $HEALTH_RESPONSE"
else
  echo -e "${RED}✗ Health check failed${NC}"
  echo "Response: $HEALTH_RESPONSE"
fi

# Test 2: Generate Website
echo ""
echo "Testing POST /generate"
GENERATE_RESPONSE=$(curl -s -X POST http://localhost:5000/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Create a simple landing page"}')

if echo "$GENERATE_RESPONSE" | grep -q "success"; then
  echo -e "${GREEN}✓ Generate endpoint responded${NC}"
  echo "Response: $GENERATE_RESPONSE"

  # Check if files were created
  if [ -d "workspace" ]; then
    FILE_COUNT=$(find workspace -type f | wc -l)
    echo -e "${GREEN}✓ Generated $FILE_COUNT file(s)${NC}"
    echo "Files:"
    find workspace -type f -exec echo "  - {}" \;
  fi
else
  echo -e "${RED}✗ Generate endpoint failed${NC}"
  echo "Response: $GENERATE_RESPONSE"
fi

# Cleanup
echo ""
echo "Cleaning up..."
kill $SERVER_PID 2>/dev/null
wait $SERVER_PID 2>/dev/null

echo ""
echo -e "${GREEN}✅ Test suite completed!${NC}"
