# Smoke Tests

## Media Cache / Range
```bash
curl -I http://localhost:3000/media/latest.mp4
curl -H "Range: bytes=0-1023" -I http://localhost:3000/media/latest.mp4
curl -I "http://localhost:3000/media/latest.mp4?v=123"
```

## Health / Ready
```bash
curl -I http://localhost:3000/healthz
curl -I http://localhost:3000/readyz
```

## Upload Validation
```bash
curl -i -X POST http://localhost:3000/api/upload \
  -H "x-upload-password: wrong" \
  -F "file=@/tmp/file.mp4"

curl -i -X POST http://localhost:3000/api/upload \
  -H "x-upload-password: $UPLOAD_PASSWORD" \
  -F "file=@/tmp/file.txt"
```

## Static + Stats + HLS
```bash
curl -i http://localhost:3000/images/icon.png -H "Origin: http://localhost:3000"
curl -i -X POST http://localhost:3000/api/stats/event \
  -H "Content-Type: application/json" \
  -d '{"type":"video_started"}'
curl -I http://localhost:3000/media/latest/master.m3u8
curl -i http://localhost:3000/api/catalog?target=acougue
open http://localhost:3000/acougue.html
# No player, testar botão Girar: deve alternar URL (landscape/portrait) sem CSS rotate.
# Upload de vídeo com rotação: conferir se sai normalizado (sem girar).

## Upload retornos
```bash
curl -i -X POST http://localhost:3000/api/upload \
  -H "x-upload-password: $UPLOAD_PASSWORD" \
  -F "file=@/tmp/video-rotated.mp4"
```
Verifique se o JSON inclui `mp4UrlLandscape`, `mp4UrlPortrait`, `hlsMasterUrlLandscape` e `hlsMasterUrlPortrait` quando habilitado.

## Doctor
```bash
npm run doctor
```
```
