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
