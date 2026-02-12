# Deploy no AWS Lightsail (Node + Nginx + PM2 + FFmpeg)

Este guia prepara o servidor para produção com proxy reverso Nginx, PM2 e suporte a HLS (`.m3u8`/`.ts`) e MP4 com Range.

## 1. Pré-requisitos

- Ubuntu 22.04+ no Lightsail
- Repositório já clonado
- Usuário com `sudo`

## 2. Setup inicial (Node 20, Nginx, FFmpeg, PM2)

No diretório do projeto:

```bash
chmod +x scripts/setup_lightsail.sh
MEDIA_DIR=/var/lib/tv-media/media APP_USER=$USER APP_GROUP=$USER ./scripts/setup_lightsail.sh
```

## 3. Variáveis de ambiente

Crie um `.env` de produção (ou exporte no shell/serviço):

```bash
PORT=3000
MEDIA_DIR=/var/lib/tv-media/media
ENABLE_HLS=true
ENABLE_PORTRAIT_VARIANTS=true
UPLOAD_PASSWORD=troque_esta_senha
TRUST_PROXY=true
```

Notas:
- `PORT=3000`: Nginx fará proxy para `127.0.0.1:3000`.
- `TRUST_PROXY=true`: recomendado atrás do Nginx.
- HLS já usa segmentos de 4s e ladder 360/720/1080 no servidor.

## 4. PM2

Suba app com ecosystem:

```bash
pm2 start ecosystem.config.js --only tv-media
pm2 save
```

Ver status:

```bash
pm2 status
pm2 logs tv-media --lines 200
```

## 5. Nginx reverse proxy

Instale o arquivo de exemplo:

```bash
sudo cp deploy/nginx-tv-media.conf /etc/nginx/sites-available/tv-media.conf
sudo ln -sf /etc/nginx/sites-available/tv-media.conf /etc/nginx/sites-enabled/tv-media.conf
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

O arquivo já define `X-Forwarded-Proto` e demais headers de proxy.

## 6. Deploy recorrente

```bash
chmod +x scripts/deploy.sh
./scripts/deploy.sh
```

O script faz:
- `git pull --ff-only`
- `npm ci --omit=dev`
- `node --check server.js`
- `nginx -t`
- `pm2 reload tv-media`
- restart do Nginx

## 7. Portas e firewall

No Lightsail Networking, deixe abertas:
- `80/tcp` (HTTP)
- `443/tcp` (quando configurar TLS)

A porta `3000` pode ficar privada (acesso local no host).

## 8. Health check

Validação rápida:

```bash
curl -sS -i http://127.0.0.1:3000/healthz
curl -sS -i http://SEU_DOMINIO_OU_IP/healthz
```

Esperado: status `200` e JSON com `{"ok": true, ...}`.

## 9. Smoke tests

Use `docs/SMOKE_TESTS.md` para validar:
- MP4 com Range (`206`)
- HLS (`.m3u8` e `.ts`) com cache `no-cache`
- headers `ETag` e `Last-Modified`
- métricas (`/metrics` e `/metrics.prom`)
