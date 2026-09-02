#!/usr/bin/env bash
# Rebuild both report-worker virtual environments from committed requirements.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
export PYTHON_BIN

bash "$ROOT_DIR/docx-worker/setup-venv.sh"
bash "$ROOT_DIR/pdf-worker/setup-venv.sh"

echo "All report-worker environments are ready."
