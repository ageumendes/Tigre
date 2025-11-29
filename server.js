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
const statsFile = path.join(__dirname, "stats.json");
const promosFile = path.join(__dirname, "promos.json");
const mediaConfigFile = path.join(__dirname, "media-config.json");
const MAX_STATS = 5000;
const MAX_PROMOS = 200;
const DEFAULT_UPLOAD_PASSWORD = process.env.UPLOAD_PASSWORD || "Tigre@12.";
const SUPPORTED_EVENT_TYPES = new Set([
  "video_started",
  "video_completed",
  "connect_clicked",
  "auth_redirect",
]);

// Extensões permitidas (vídeo e imagens) para o portal cativo.
const ALLOWED_EXT = [".mp4", ".jpg", ".jpeg", ".png", ".webp"];
const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

fs.mkdirSync(mediaDir, { recursive: true });

const storageSingle = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mediaDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const isVideo = ext === ".mp4";
    const baseName = isVideo ? "latest" : "latest-image";
    cb(null, `${baseName}${ext}`);
  },
});

const storageCarousel = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mediaDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    cb(null, `carousel-${unique}${ext}`);
  },
});

const upload = multer({
  storage: storageSingle,
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || "200", 10) || 200) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const allowed = ALLOWED_EXT.includes(ext);
    if (!allowed) return cb(new Error("Apenas MP4 ou imagens (jpg/png/webp) são aceitos."));
    cb(null, true);
  },
});

const uploadCarousel = multer({
  storage: storageCarousel,
  limits: { fileSize: (parseInt(process.env.MAX_UPLOAD_MB || "200", 10) || 200) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const allowed = isImageExt(ext);
    if (!allowed) return cb(new Error("Apenas imagens (jpg/png/webp) são aceitas no carrossel."));
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
    const candidates = [`latest${ext}`, `latest-image${ext}`];
    for (const name of candidates) {
      if (files.includes(name)) {
        const fullPath = path.join(mediaDir, name);
        const mime = MIME_BY_EXT[ext] || "application/octet-stream";
        return { name, fullPath, mime };
      }
    }
  }
  return null;
};

// Mantido para compatibilidade interna (remove tudo exceto keepName).
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

const readStats = () => {
  try {
    if (!fs.existsSync(statsFile)) return [];
    const raw = fs.readFileSync(statsFile, "utf8");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Erro ao ler stats.json:", error.message);
    return [];
  }
};

const writeStats = (events) => {
  const trimmed = events.slice(-MAX_STATS);
  try {
    fs.writeFileSync(statsFile, JSON.stringify(trimmed, null, 2));
  } catch (error) {
    console.error("Erro ao gravar stats.json:", error.message);
    throw error;
  }
  return trimmed;
};

const safeStr = (value, max = 256) => (typeof value === "string" ? value.slice(0, max) : "");

// Middleware simples para exigir senha no upload. Use a variável de ambiente UPLOAD_PASSWORD para trocar o valor.
const requireUploadAuth = (req, res, next) => {
  const secret = DEFAULT_UPLOAD_PASSWORD;
  const provided = req.headers["x-upload-password"];
  if (!secret) {
    return res.status(500).json({ ok: false, message: "Senha de upload não configurada no servidor." });
  }
  if (provided !== secret) {
    return res.status(401).json({ ok: false, message: "Senha inválida para upload." });
  }
  return next();
};

const formatDay = (timestamp) => {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
};

// ===== Helpers de configuração de mídia =====
const getMimeFromExt = (ext) => MIME_BY_EXT[ext.toLowerCase()] || "application/octet-stream";
const isImageExt = (ext) => [".jpg", ".jpeg", ".png", ".webp"].includes(ext.toLowerCase());

const readMediaConfig = () => {
  try {
    if (!fs.existsSync(mediaConfigFile)) return null;
    const raw = fs.readFileSync(mediaConfigFile, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Erro ao ler media-config.json:", error.message);
    return null;
  }
};

const writeMediaConfig = (mode, items) => {
  const config = {
    mode,
    items,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(mediaConfigFile, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error("Erro ao gravar media-config.json:", error.message);
    throw error;
  }
  return config;
};

const summarizeFile = (fileName) => {
  const fullPath = path.join(mediaDir, fileName);
  const stats = fs.statSync(fullPath);
  const ext = (path.extname(fileName) || "").toLowerCase();
  return {
    path: `/media/${fileName}`,
    mime: getMimeFromExt(ext),
    size: stats.size,
    updatedAt: stats.mtimeMs,
  };
};

const cleanupKeeping = (keepList) => {
  const keepSet = new Set(keepList);
  const files = fs.readdirSync(mediaDir);
  for (const file of files) {
    if (keepSet.has(file)) continue;
    try {
      fs.unlinkSync(path.join(mediaDir, file));
    } catch (error) {
      console.warn(`Não foi possível remover ${file}:`, error.message);
    }
  }
};

const readPromos = () => {
  try {
    if (!fs.existsSync(promosFile)) return [];
    const raw = fs.readFileSync(promosFile, "utf8");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Erro ao ler promos.json:", error.message);
    return [];
  }
};

const writePromos = (promos) => {
  const trimmed = promos.slice(-MAX_PROMOS);
  try {
    fs.writeFileSync(promosFile, JSON.stringify(trimmed, null, 2));
  } catch (error) {
    console.error("Erro ao gravar promos.json:", error.message);
    throw error;
  }
  return trimmed;
};

const normalizePromoPayload = (body = {}) => {
  const now = Date.now();
  return {
    title: safeStr(body.title, 160),
    description: safeStr(body.description, 1024),
    price: safeStr(body.price, 64),
    badge: safeStr(body.badge, 64),
    validUntil: safeStr(body.validUntil, 32),
    imageUrl: safeStr(body.imageUrl, 512),
    active: body.active !== false,
    updatedAt: now,
  };
};

const isPromoActive = (promo) => {
  if (!promo) return false;
  if (promo.active === false) return false;
  if (!promo.validUntil) return true;
  const until = Date.parse(promo.validUntil);
  if (Number.isNaN(until)) return true;
  return until >= Date.now();
};

app.get("/api/info", (_req, res) => {
  const config = readMediaConfig();
  if (config?.items?.length) {
    const primary = config.items[0];
    return res.json({
      ok: true,
      mode: config.mode || "video",
      path: primary.path,
      mime: primary.mime,
      size: primary.size,
      updatedAt: primary.updatedAt,
      items: config.items,
      configUpdatedAt: config.updatedAt,
    });
  }

  // Fallback legacy: apenas latest.mp4
  const latest = findLatestFile();
  if (!latest) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }
  const stats = fs.statSync(latest.fullPath);
  return res.json({
    ok: true,
    mode: "video",
    path: `/media/${latest.name}`,
    mime: latest.mime,
    size: stats.size,
    updatedAt: stats.mtimeMs,
    items: [
      {
        path: `/media/${latest.name}`,
        mime: latest.mime,
        size: stats.size,
        updatedAt: stats.mtimeMs,
      },
    ],
  });
});

app.post("/api/upload", requireUploadAuth, upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: "Arquivo ausente no campo 'file'." });
  }

  const ext = (path.extname(req.file.originalname) || "").toLowerCase();
  const isVideo = ext === ".mp4";
  const mode = isVideo ? "video" : "image";

  const item = summarizeFile(req.file.filename);
  try {
    writeMediaConfig(mode, [item]);
    cleanupKeeping([req.file.filename]);
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao salvar configuração da mídia." });
  }

  return res.json({
    ok: true,
    mode,
    path: item.path,
    mime: item.mime,
    size: item.size,
    updatedAt: item.updatedAt,
    items: [item],
  });
});

// Upload de carrossel de imagens (máx. 10).
app.post("/api/upload-carousel", requireUploadAuth, uploadCarousel.array("files", 10), (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return res.status(400).json({ ok: false, message: "Nenhum arquivo enviado (campo 'files')." });
  }

  if (files.length > 10) {
    return res.status(400).json({ ok: false, message: "Envie no máximo 10 imagens para o carrossel." });
  }

  const items = files.map((file) => summarizeFile(file.filename));

  try {
    writeMediaConfig("carousel", items);
    cleanupKeeping(files.map((f) => f.filename));
  } catch (error) {
    return res.status(500).json({ ok: false, message: "Erro ao salvar configuração do carrossel." });
  }

  return res.json({
    ok: true,
    mode: "carousel",
    path: items[0].path,
    mime: items[0].mime,
    size: items[0].size,
    updatedAt: items[0].updatedAt,
    items,
  });
});

app.get("/media/latest", (_req, res) => {
  const config = readMediaConfig();
  if (config?.items?.length) {
    const primary = config.items[0];
    const filePath = path.join(mediaDir, path.basename(primary.path));
    if (!fs.existsSync(filePath)) return res.sendStatus(404);
    res.setHeader("Content-Type", primary.mime || "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    return res.sendFile(filePath);
  }

  const latest = findLatestFile();
  if (!latest) return res.sendStatus(404);
  res.setHeader("Content-Type", latest.mime);
  res.setHeader("Cache-Control", "no-cache");
  return res.sendFile(latest.fullPath);
});

// CRUD simples de promoções (promos.json).
app.get("/api/promos", (req, res) => {
  const activeOnly = req.query.active === "true" || req.query.active === "1";
  const promos = readPromos();
  const sorted = [...promos].sort(
    (a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0)
  );
  const filtered = activeOnly ? sorted.filter((p) => isPromoActive(p)) : sorted;
  return res.json({ ok: true, promos: filtered });
});

app.get("/api/promos/:id", (req, res) => {
  const promos = readPromos();
  const promo = promos.find((p) => p.id === req.params.id);
  if (!promo) return res.status(404).json({ ok: false, message: "Promoção não encontrada." });
  return res.json({ ok: true, promo });
});

app.post("/api/promos", (req, res) => {
  const payload = normalizePromoPayload(req.body);
  if (!payload.title) return res.status(400).json({ ok: false, message: "Título é obrigatório." });
  const now = Date.now();
  const promo = {
    id: `${now}-${Math.random().toString(16).slice(2, 8)}`,
    ...payload,
    createdAt: now,
  };
  try {
    const promos = readPromos();
    promos.push(promo);
    writePromos(promos);
    return res.json({ ok: true, promo });
  } catch (error) {
    console.error("Erro ao criar promoção:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao salvar promoção." });
  }
});

app.put("/api/promos/:id", (req, res) => {
  const payload = normalizePromoPayload(req.body);
  const promos = readPromos();
  const index = promos.findIndex((p) => p.id === req.params.id);
  if (index === -1) return res.status(404).json({ ok: false, message: "Promoção não encontrada." });
  const existing = promos[index];
  promos[index] = {
    ...existing,
    ...payload,
    id: existing.id,
    createdAt: existing.createdAt || Date.now(),
  };
  try {
    writePromos(promos);
    return res.json({ ok: true, promo: promos[index] });
  } catch (error) {
    console.error("Erro ao atualizar promoção:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao atualizar promoção." });
  }
});

app.delete("/api/promos/:id", (req, res) => {
  const promos = readPromos();
  const next = promos.filter((p) => p.id !== req.params.id);
  if (next.length === promos.length) {
    return res.status(404).json({ ok: false, message: "Promoção não encontrada." });
  }
  try {
    writePromos(next);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao remover promoção:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao remover promoção." });
  }
});

// Registro de eventos simples para dashboard.
app.post("/api/stats/event", (req, res) => {
  const { type, clientMac, clientIp, ssid, userAgent } = req.body || {};
  if (!SUPPORTED_EVENT_TYPES.has(type)) {
    return res.status(400).json({ ok: false, message: "Tipo de evento inválido." });
  }

  const event = {
    timestamp: Date.now(),
    type,
    clientMac: safeStr(clientMac),
    clientIp: safeStr(clientIp),
    ssid: safeStr(ssid),
    userAgent: safeStr(userAgent || req.headers["user-agent"] || ""),
  };

  try {
    const events = readStats();
    events.push(event);
    writeStats(events);
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao registrar evento:", error.message);
    return res.status(500).json({ ok: false, message: "Falha ao registrar evento." });
  }
});

app.get("/api/stats/summary", (_req, res) => {
  const events = readStats();
const summary = {
    totalEvents: events.length,
    totalVideoStarted: 0,
    totalVideoCompleted: 0,
    totalConnectClicked: 0,
    totalAuthRedirect: 0,
    totalDownloadClicked: 0,
    totalShareClicked: 0,
    bySsid: {},
    byDay: {},
  };

  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    summary.byDay[key] = 0;
    days.push(key);
  }
  const minDay = new Date(today);
  minDay.setDate(today.getDate() - 6);
  const minTimestamp = minDay.getTime();

  for (const event of events) {
    if (event.type === "video_started") summary.totalVideoStarted += 1;
    if (event.type === "video_completed") summary.totalVideoCompleted += 1;
    if (event.type === "connect_clicked") summary.totalConnectClicked += 1;
    if (event.type === "auth_redirect") summary.totalAuthRedirect += 1;
    if (event.type === "download_clicked") summary.totalDownloadClicked += 1;
    if (event.type === "share_clicked") summary.totalShareClicked += 1;

    const ssidKey = event.ssid || "desconhecido";
    summary.bySsid[ssidKey] = (summary.bySsid[ssidKey] || 0) + 1;

    if (event.timestamp >= minTimestamp) {
      const dayKey = formatDay(event.timestamp);
      if (Object.prototype.hasOwnProperty.call(summary.byDay, dayKey)) {
        summary.byDay[dayKey] += 1;
      }
    }
  }

  return res.json({ ok: true, ...summary });
});

app.get("/api/stats/recent", (req, res) => {
  const requested = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(requested) ? Math.min(MAX_STATS, Math.max(1, requested)) : 100;
  const events = readStats();
  const recent = events.slice(-limit).reverse();
  return res.json({ ok: true, events: recent });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  const message = err.message || "Erro interno";
  return res.status(400).json({ ok: false, message });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
