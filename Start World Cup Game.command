#!/bin/zsh
# ⚽ Double-click me to start Road to the Cup 2026!
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
( sleep 1 && open "http://localhost:8336" ) &
exec node server.js
