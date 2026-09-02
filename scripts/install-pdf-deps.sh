#!/usr/bin/env bash
# تثبيت LibreOffice لتحويل Word وPowerPoint إلى PDF على خوادم Ubuntu/Debian (PM2 أو Docker).
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
  if command -v soffice >/dev/null 2>&1 || command -v libreoffice >/dev/null 2>&1; then
    echo "LibreOffice already available:"
    command -v soffice || true
    command -v libreoffice || true
    exit 0
  fi
  echo "apt-get not found. Install headless LibreOffice Writer and Impress manually, then set LIBREOFFICE_PATH."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  libreoffice-writer-nogui \
  libreoffice-impress-nogui \
  fonts-dejavu-core \
  fonts-noto-core

echo "Installed. soffice=$(command -v soffice || true) libreoffice=$(command -v libreoffice || true)"
echo "Restart the Nest backend (e.g. pm2 restart spark-vision-backend) after install."
