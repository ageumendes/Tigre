# Smoke Tests

## Portal cativo v2.16

1. Abra `/captive.html` com duas ou mais imagens publicadas.
2. Arraste horizontalmente e confirme a troca nos dois sentidos com animação.
3. Toque em **Baixar** e confirme extensão `.jpg` e tipo `image/jpeg`.
4. Em um celular compatível, toque em **Compartilhar** e confirme que o menu recebe o arquivo JPG.
5. Clique rapidamente várias vezes em **Conectar ao Wi-Fi** e confirme apenas um `connect_clicked` no dashboard.

## Dashboard v2.16

1. Compare os períodos de 7 e 30 dias.
2. Confirme dispositivos únicos, sessões, conclusão, liberações, downloads e compartilhamentos.
3. Verifique as séries de visualizações e conexões no gráfico.
4. Confirme a distribuição por SSID.
5. Confirme que rajadas idênticas aparecem apenas uma vez em **Eventos válidos mais recentes**.
6. Confirme que **Qualidade dos dados** informa quantas duplicidades históricas foram ignoradas.

## Health / Ready
```bash
curl -i http://localhost:3000/healthz
curl -i http://localhost:3000/readyz
```

## Metrics (novo + legado)
```bash
curl -i http://localhost:3000/metrics
curl -i http://localhost:3000/metrics.prom
```

## MP4 Range (Roku)
```bash
curl -I http://localhost:3000/media/latest.mp4
curl -H "Range: bytes=0-1023" -I http://localhost:3000/media/latest.mp4
```

Esperado no segundo comando:
- `HTTP/1.1 206 Partial Content`
- `Accept-Ranges: bytes`
- `Content-Range: bytes 0-1023/...`

## HLS Headers (.m3u8 e .ts)
```bash
curl -I http://localhost:3000/media/latest/master.m3u8
curl -I http://localhost:3000/media/latest/0/segment_000.ts
```

Esperado:
- `Cache-Control: no-cache`
- `ETag: ...`
- `Last-Modified: ...`

## Manifest Cache Validation
```bash
curl -i http://localhost:3000/api/media/manifest?target=todas
curl -i http://localhost:3000/api/info?target=todas
```

Confirme que, havendo temporárias válidas e permanentes, `items` contém os dois tipos
em ordem intercalada. Sem temporárias válidas, devem permanecer apenas os itens com
`permanent: true`. Repita a verificação no catálogo usado pelo Roku:

```bash
curl -s "http://localhost:3000/api/catalog?target=todas&client=roku"
```

Esperado:
- `Cache-Control: no-cache`
- `ETag` forte
- `Last-Modified`

## Upload Validation
```bash
curl -i -X POST http://localhost:3000/api/upload \
  -H "x-upload-password: wrong" \
  -F "file=@/tmp/file.mp4"

curl -i -X POST http://localhost:3000/api/upload \
  -H "x-upload-password: $UPLOAD_PASSWORD" \
  -F "file=@/tmp/file.txt"
```

## Stats + Catalog
```bash
curl -i -X POST http://localhost:3000/api/stats/event \
  -H "Content-Type: application/json" \
  -d '{"type":"video_started"}'
curl -i http://localhost:3000/api/catalog?target=acougue
```

## Player
```bash
open http://localhost:3000/acougue.html
```

No player, validar:
- troca de orientação (`landscape/portrait`) sem rotação CSS
- reprodução por HLS (`.m3u8`) e fallback MP4

## Doctor
```bash
npm run doctor
```
