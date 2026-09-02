#!/usr/bin/env bash
# Create the reproducible Python environment used by the HTML/WeasyPrint PDF worker.
set -euo pipefail
cd "$(dirname "$0")"

PYTHON_BIN="${PYTHON_BIN:-python3}"
VENV_DIR="${PDF_WORKER_VENV_DIR:-.venv}"

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$VENV_DIR"
fi

"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install --disable-pip-version-check -r requirements.txt
"$VENV_DIR/bin/python" -c "import PIL, pdf2image, weasyprint; print('pdf-worker ready:', __import__('sys').executable)"
