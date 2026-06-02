#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-5173}"

ok() { echo "[ok] $*"; }
warn() { echo "[warn] $*"; }
fail() { echo "[fail] $*"; }

check_cmd() {
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1: $(command -v "$1")"
  else
    warn "$1 not found"
  fi
}

echo "Spectral Urbanism local readiness"
echo "Repo: $ROOT_DIR"
echo

check_cmd python3
check_cmd node
check_cmd npm
check_cmd docker

if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  ok ".venv exists"
  "$ROOT_DIR/.venv/bin/python" - <<'PY'
import importlib.util
mods = ["spectral_urbanism", "fastapi", "uvicorn", "pydantic"]
missing = [m for m in mods if importlib.util.find_spec(m) is None]
if missing:
    print("[fail] missing Python modules: " + ", ".join(missing))
    raise SystemExit(1)
print("[ok] Python imports: " + ", ".join(mods))
PY
else
  warn ".venv missing; run: make setup install-services"
fi

if [[ -d "$ROOT_DIR/web/node_modules" ]]; then
  ok "web/node_modules exists"
else
  warn "web/node_modules missing; run: cd web && npm install"
fi

if curl -fsS "http://localhost:${API_PORT}/api/v1/health" >/dev/null 2>&1; then
  ok "API reachable at http://localhost:${API_PORT}/api/v1/health"
else
  warn "API not reachable at http://localhost:${API_PORT}/api/v1/health"
fi

if curl -fsS "http://localhost:${WEB_PORT}" >/dev/null 2>&1; then
  ok "Web reachable at http://localhost:${WEB_PORT}"
else
  warn "Web not reachable at http://localhost:${WEB_PORT}"
fi

echo
echo "Recommended local start:"
echo "  make local-dev"
echo
echo "Docker start:"
echo "  make compose-up"
