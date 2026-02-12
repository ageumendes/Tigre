#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${APP_DIR}"

echo "[deploy] fetching latest changes"
git pull --ff-only

echo "[deploy] installing dependencies"
npm ci --omit=dev

echo "[deploy] validating server syntax"
node --check server.js

echo "[deploy] validating nginx config"
sudo nginx -t

echo "[deploy] reloading pm2 app"
pm2 reload tv-media || pm2 start ecosystem.config.js --only tv-media
pm2 save

echo "[deploy] restarting nginx"
sudo systemctl restart nginx

echo "[deploy] done"
