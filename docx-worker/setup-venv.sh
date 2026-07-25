#!/usr/bin/env bash
# إعداد بيئة بايثون لعامل دمج Word على السيرفر.
set -euo pipefail
cd "$(dirname "$0")"
PYTHON_BIN="${PYTHON_BIN:-python3}"
if [[ ! -x "venv/bin/python" ]]; then
  "$PYTHON_BIN" -m venv venv
fi
./venv/bin/python -m pip install --upgrade pip
./venv/bin/pip install --disable-pip-version-check -r requirements.txt
./venv/bin/python -c "import lxml, PIL, docx; print('docx-worker ready:', __import__('sys').executable)"
