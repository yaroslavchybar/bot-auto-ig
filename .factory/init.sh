#!/bin/bash
set -e

cd "$(dirname "$0")/.."

# Install Node.js dependencies (idempotent)
if [ ! -d "node_modules" ]; then
  npm install
fi

if [ ! -d "frontend/node_modules" ]; then
  npm --prefix frontend install
fi

if [ ! -d "server/node_modules" ]; then
  npm --prefix server install
fi

# Install Python dependencies (idempotent)
pip install -r python/requirements.txt -q 2>/dev/null || python -m pip install -r python/requirements.txt -q 2>/dev/null || true

echo "Environment setup complete."
