#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$ROOT_DIR/.local/dev-pids"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No running dev pid file at $PID_FILE"
  exit 0
fi

while IFS= read -r pid; do
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "Stopped pid $pid"
  fi
done < "$PID_FILE"

rm -f "$PID_FILE"
echo "Stopped local dev services."
