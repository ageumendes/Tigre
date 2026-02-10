# Setup Lightsail (Ubuntu)

## Dependências básicas
```bash
sudo apt update
sudo apt install -y ffmpeg
```

## Node.js (recomendado)
- Node 18+ ou 20 LTS.

## Variáveis de ambiente (exemplo)
```bash
export PORT=3000
export MEDIA_DIR=/home/ubuntu/Servidor-tv-Tigre/media
export ENABLE_HLS=true
export ENABLE_PORTRAIT_VARIANTS=true
export HLS_RENDITIONS="240,360,720,1080"
export IMAGE_VARIANTS="1920,1280,720"
export IMAGE_VARIANTS_PORTRAIT="1080,720"
export IMAGE_DURATION_MS=8000
export UPLOAD_PASSWORD="sua_senha"
```

## Estrutura de diretórios
- `media/normalized`
- `media/hls/<target>/<mediaId>/(landscape|portrait)`
- `media/images`
- `media/images/variants`
- `media/images/posters`

## Execução
```bash
npm install
npm run start
```

## PM2 (opcional)
```bash
npm install -g pm2
pm2 start server.js --name tigre-media
pm2 save
```

## Nginx (opcional)
Use como reverse proxy para HTTPS/HTTP2.
