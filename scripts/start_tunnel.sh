#!/bin/bash

# Exit on error
set -e

PORT=9090

# Ensure cleanup on exit
cleanup() {
  echo -e "\nStopping local notification server and ngrok..."
  if [ ! -z "$SERVER_PID" ]; then kill $SERVER_PID 2>/dev/null || true; fi
  if [ ! -z "$NGROK_PID" ]; then kill $NGROK_PID 2>/dev/null || true; fi
  exit 0
}
trap cleanup INT TERM EXIT

echo "🚀 Starting local Webhook Notification Server on port $PORT..."
node scripts/notification_server.js &
SERVER_PID=$!

# Give server a moment to spin up
sleep 1.5

echo "🌐 Starting ngrok tunnel on port $PORT..."
# Start ngrok in background
ngrok http $PORT > /dev/null &
NGROK_PID=$!

# Wait for ngrok to initialize
sleep 3

echo "🔍 Retrieving public ngrok URL..."
NGROK_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -o 'https://[^"]*ngrok-free.dev' | head -n 1)

if [ -z "$NGROK_URL" ]; then
  echo "❌ Error: Could not retrieve ngrok URL. Make sure ngrok is configured."
  exit 1
fi

echo "✅ Active ngrok URL: $NGROK_URL"

# Set secrets on GitHub
echo "🔐 Updating DEPLOY_PING_URL on GitHub via gh CLI..."
gh secret set DEPLOY_PING_URL --repo ljack/fas-sudoku-app --body "$NGROK_URL"
gh secret set DEPLOY_PING_URL --repo ljack/fas-sudoku-p2p --body "$NGROK_URL"

echo -e "\n🎉 Webhook tunnel loop is fully active!"
echo "- Local Server: http://localhost:$PORT (PID $SERVER_PID)"
echo "- Public Gateway: $NGROK_URL"
echo "Keep this script running. Press [Ctrl+C] to stop."

# Wait for background jobs
wait $SERVER_PID $NGROK_PID
