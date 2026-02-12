#!/usr/bin/env bash
set -euo pipefail

MEDIA_DIR="${MEDIA_DIR:-/var/lib/tv-media/media}"
APP_USER="${APP_USER:-$USER}"
APP_GROUP="${APP_GROUP:-$USER}"

echo "[setup] apt update"
sudo apt-get update -y

echo "[setup] base packages"
sudo apt-get install -y nginx ffmpeg curl ca-certificates gnupg git

if ! command -v node >/dev/null 2>&1 || ! node -v | grep -qE '^v20\.'; then
  echo "[setup] installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "[setup] node version: $(node -v)"
echo "[setup] npm version: $(npm -v)"
echo "[setup] ffmpeg version: $(ffmpeg -version | head -n1)"

echo "[setup] installing pm2"
sudo npm install -g pm2

echo "[setup] creating MEDIA_DIR: ${MEDIA_DIR}"
sudo mkdir -p "${MEDIA_DIR}" "${MEDIA_DIR}/.tmp"
sudo chown -R "${APP_USER}:${APP_GROUP}" "${MEDIA_DIR}"
sudo chmod -R 775 "${MEDIA_DIR}"

echo "[setup] enabling nginx"
sudo systemctl enable nginx
sudo systemctl start nginx

echo "[setup] pm2 startup"
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" | sed 's/^/[pm2-startup] /'
pm2 save

echo "[setup] done"
echo "[setup] export MEDIA_DIR=${MEDIA_DIR} before pm2 start/reload"
