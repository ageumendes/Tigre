const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const mediaDir = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(__dirname, "media");

// Restrito para MP4 (H.264/AAC) para compatibilidade com splash.
const ALLOWED_EXT = [".mp4"];
const MIME_BY_EXT = {
  ".mp4": "video/mp4",
};

fs.mkdirSync(mediaDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mediaDir),
  filename: (_req, file, cb) => {
    cb(null, "latest.mp4");
  },
});

const upload = multer({
  storage,
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || "200", 10) || 200) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const isMp4 = ALLOWED_EXT.includes(ext) || file.mimetype === "video/mp4";
    if (!isMp4) return cb(new Error("Apenas MP4 (H.264/AAC) é aceito."));
    cb(null, true);
  },
});

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
  })
);
app.use(express.json());
app.use(express.static(path.join(__dirname), { maxAge: 0 }));
app.use(
  "/media",
  express.static(mediaDir, {
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      if (MIME_BY_EXT[ext]) res.setHeader("Content-Type", MIME_BY_EXT[ext]);
      res.setHeader("Cache-Control", "no-cache");
    },
  })
);

const findLatestFile = () => {
  const files = fs.readdirSync(mediaDir);
  for (const ext of ALLOWED_EXT) {
    const name = `latest${ext}`;
    if (files.includes(name)) {
      const fullPath = path.join(mediaDir, name);
      const mime = MIME_BY_EXT[ext] || "application/octet-stream";
      return { name, fullPath, mime };
    }
  }
  return null;
};

const cleanupKeepingOnly = (keepName) => {
  const files = fs.readdirSync(mediaDir);
  for (const file of files) {
    if (file === keepName) continue;
    try {
      fs.unlinkSync(path.join(mediaDir, file));
    } catch (err) {
      console.warn(`Não foi possível remover ${file}:`, err.message);
    }
  }
};

app.get("/api/info", (_req, res) => {
  const latest = findLatestFile();
  if (!latest) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }
  const stats = fs.statSync(latest.fullPath);
  return res.json({
    ok: true,
    path: `/media/${latest.name}`,
    mime: latest.mime,
    size: stats.size,
    updatedAt: stats.mtimeMs,
  });
});

app.post("/api/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: "Arquivo ausente no campo 'file'." });
  }

  cleanupKeepingOnly(req.file.filename);

  return res.json({
    ok: true,
    path: `/media/${req.file.filename}`,
    mime: req.file.mimetype,
    size: req.file.size,
    updatedAt: Date.now(),
  });
});

app.get("/media/latest", (_req, res) => {
  const latest = findLatestFile();
  if (!latest) return res.sendStatus(404);
  res.setHeader("Content-Type", latest.mime);
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(latest.fullPath);
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const message = err.message || "Erro interno";
  return res.status(400).json({ ok: false, message });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
