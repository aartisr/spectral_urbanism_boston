#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_PATH="${1:-${SPECTRAL_URBANISM_CONFIG:-$ROOT_DIR/configs/boston.yaml}}"

if [[ ! -f "$CONFIG_PATH" && -f "$ROOT_DIR/configs/city.yaml" ]]; then
	CONFIG_PATH="$ROOT_DIR/configs/city.yaml"
fi

if [[ -x "$ROOT_DIR/.venv/bin/spectral-urbanism" ]]; then
	"$ROOT_DIR/.venv/bin/spectral-urbanism" run --config "$CONFIG_PATH"
else
	spectral-urbanism run --config "$CONFIG_PATH"
fi
