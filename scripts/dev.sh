#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$ROOT_DIR/.local/dev-logs"
PID_FILE="$ROOT_DIR/.local/dev-pids"
mkdir -p "$LOG_DIR"

if [[ -f "$ROOT_DIR/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT_DIR/.env"
  set +a
fi

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"
REDIS_PORT="${REDIS_PORT:-6379}"
DEV_WITH_WORKER="${DEV_WITH_WORKER:-0}"
DEV_AUTO_INSTALL="${DEV_AUTO_INSTALL:-1}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}/0}"

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
PIP_BIN="$ROOT_DIR/.venv/bin/pip"
UVICORN_BIN="$ROOT_DIR/.venv/bin/uvicorn"
CELERY_BIN="$ROOT_DIR/.venv/bin/celery"

ensure_python_env() {
  if [[ ! -x "$PYTHON_BIN" ]]; then
    if [[ "$DEV_AUTO_INSTALL" != "1" ]]; then
      echo "[dev] missing .venv. Run: make setup install-services"
      exit 1
    fi
    echo "[dev] creating .venv"
    python3 -m venv "$ROOT_DIR/.venv"
  fi

  if [[ "$DEV_AUTO_INSTALL" == "1" ]]; then
    echo "[dev] ensuring Python packages are installed"
    "$PIP_BIN" install -U pip >/dev/null
    "$PIP_BIN" install -e "$ROOT_DIR" -e "$ROOT_DIR/services/api" >/dev/null
    if [[ "$DEV_WITH_WORKER" == "1" ]]; then
      "$PIP_BIN" install -e "$ROOT_DIR/services/worker" >/dev/null
    fi
  fi

  if [[ ! -x "$UVICORN_BIN" ]]; then
    echo "[dev] uvicorn not found in .venv. Run: make install-services"
    exit 1
  fi
  if [[ "$DEV_WITH_WORKER" == "1" && ! -x "$CELERY_BIN" ]]; then
    echo "[dev] celery not found in .venv. Run: make install-services"
    exit 1
  fi
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts="${3:-40}"
  local delay="${4:-0.25}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "[dev] $name ready: $url"
      return 0
    fi
    sleep "$delay"
  done
  echo "[dev] $name did not become ready: $url"
  return 1
}

cleanup() {
  if [[ -f "$PID_FILE" ]]; then
    while IFS= read -r pid; do
      if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
        kill "$pid" 2>/dev/null || true
      fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
}

trap cleanup EXIT INT TERM

touch "$PID_FILE"

ensure_python_env

start_bg() {
  local name="$1"
  shift
  local log_file="$LOG_DIR/${name}.log"
  echo "[dev] starting $name (log: $log_file)"
  (
    cd "$ROOT_DIR"
    "$@"
  ) >"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" >> "$PID_FILE"
}

if [[ "$DEV_WITH_WORKER" == "1" ]]; then
  if ! command -v redis-cli >/dev/null 2>&1 || ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    if command -v redis-server >/dev/null 2>&1; then
      start_bg "redis" redis-server --port "$REDIS_PORT" --save "" --appendonly no
      sleep 1
    else
      echo "[dev] DEV_WITH_WORKER=1 requires Redis (redis-server not found)."
      exit 1
    fi
  fi
fi

start_bg "api" env RUN_EXECUTION_MODE="${RUN_EXECUTION_MODE:-inline}" ALLOW_INLINE_FALLBACK=true REDIS_URL="$REDIS_URL" "$UVICORN_BIN" app.main:app --app-dir services/api --reload --port "$API_PORT"
wait_for_url "api" "http://localhost:${API_PORT}/api/v1/health" 60 0.25 || {
  echo "[dev] API log follows:"
  tail -80 "$LOG_DIR/api.log" || true
  exit 1
}

if [[ "$DEV_WITH_WORKER" == "1" ]]; then
  start_bg "worker" env REDIS_URL="$REDIS_URL" "$CELERY_BIN" -A app.worker.celery_app worker --workdir services/worker -Q runs --loglevel=INFO
fi

if [[ ! -d "$ROOT_DIR/web/node_modules" ]]; then
  echo "[dev] installing web dependencies"
  (cd "$ROOT_DIR/web" && npm install)
fi

rm -rf "$ROOT_DIR/web/node_modules/.vite"

start_bg "web" env VITE_API_BASE="${VITE_API_BASE:-http://localhost:${API_PORT}/api/v1}" bash -lc "cd '$ROOT_DIR/web' && npm run dev -- --host 127.0.0.1 --port '$WEB_PORT'"
wait_for_url "web" "http://localhost:${WEB_PORT}" 60 0.25 || {
  echo "[dev] Web log follows:"
  tail -80 "$LOG_DIR/web.log" || true
  exit 1
}

echo
if [[ "$DEV_WITH_WORKER" == "1" ]]; then
  echo "[dev] Local stack started (api + worker + web)."
else
  echo "[dev] Local stack started (api inline + web)."
fi
echo "[dev] API: http://localhost:${API_PORT}/api/v1/health"
echo "[dev] Web: http://localhost:${WEB_PORT}"
echo "[dev] Logs: $LOG_DIR"
echo "[dev] Press Ctrl+C to stop all started services."
echo

wait -n || true
