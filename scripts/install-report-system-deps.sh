#!/usr/bin/env bash
# Ubuntu/Debian libraries required by the Python report workers.
# This intentionally does not install LibreOffice.
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  echo "apt-get was not found; install Python venv, Pango, HarfBuzz and Poppler manually."
  exit 1
fi

if [[ "${EUID}" -eq 0 ]]; then
  APT=(apt-get)
elif command -v sudo >/dev/null 2>&1; then
  APT=(sudo apt-get)
else
  echo "Run this script as root or install sudo."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
"${APT[@]}" update
"${APT[@]}" install -y --no-install-recommends \
  python3 \
  python3-pip \
  python3-venv \
  libpango-1.0-0 \
  libpangoft2-1.0-0 \
  libharfbuzz-subset0 \
  libopenjp2-7 \
  libffi8 \
  shared-mime-info \
  poppler-utils \
  fontconfig \
  fonts-dejavu-core \
  fonts-noto-core

echo "Report-worker system dependencies are ready."
