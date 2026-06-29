#!/bin/bash

# Auto-start nomad server in background if not already running.
# This script is sourced from ~/.bashrc on sandbox shell open.

if ! pgrep -f "server/index.js" > /dev/null 2>&1; then
  nohup nomad start --port 3001 > /tmp/nomad-ui.log 2>&1 &
  disown

  echo ""
  echo "  nomad is starting on port 3001..."
  echo ""
  echo "  Forward the port from another terminal:"
  echo "    sbx ports <sandbox-name> --publish 3001:3001"
  echo ""
  echo "  Then open: http://localhost:3001"
  echo ""
fi
