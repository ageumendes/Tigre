try {
  require("dotenv").config();
} catch (_error) {
  console.warn("dotenv não disponível; as variáveis deverão vir de outras fontes.");
}
const { execFile } = require("child_process");
const { randomUUID } = require("crypto");
const express = require("express");
const compression = require("compression");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const pino = require("pino");
const pinoHttp = require("pino-http");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const path = require("path");
const OpenAI = require("openai");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
const ffmpegPath = (ffmpegInstaller && ffmpegInstaller.path) || "ffmpeg";
if (!ffmpegInstaller?.path) {
  console.warn("FFmpeg instalador não localizado; aguardando binário 'ffmpeg' no PATH.");
}
const { renderWeatherPortrait } = require("./weatherScreenshot");

const app = express();
const PORT = process.env.PORT || 3000;
const mediaDir = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(__dirname, "media");
const ROTATED_MEDIA_FOLDER = "rotacionado";
const LEGACY_ROTATED_MEDIA_FOLDER = "retacionado";
const rotatedMediaDir = path.join(mediaDir, ROTATED_MEDIA_FOLDER);
const legacyRotatedMediaDir = path.join(mediaDir, LEGACY_ROTATED_MEDIA_FOLDER);
const screenshotDir = path.join(mediaDir, "screenshots");
const WEATHER_PORTRAIT_CACHE_MS = 5 * 60 * 1000;
const WEATHER_PORTRAIT_FILENAME = "weather-portrait.jpeg";
const weatherPortraitPath = path.join(screenshotDir, WEATHER_PORTRAIT_FILENAME);
let weatherPortraitPromise = null;
const statsFile = path.join(__dirname, "stats.json");
const promosFile = path.join(__dirname, "promos.json");
const mediaConfigFile = path.join(__dirname, "media-config.json");
const tvConfigFile = path.join(__dirname, "tv-config.json");
const pkg = require("./package.json");
const APP_VERSION = process.env.APP_VERSION || pkg.version || "0.0.0";
const weatherCallRecordFile = path.join(os.tmpdir(), "tigre-weather-call.json");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";
const WEATHER_MEDIA_BASE_URL = (PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/+$/, "");
const FORECAST_URL_RAW = process.env.FORECAST_URL;
const FORECAST_URL = typeof FORECAST_URL_RAW === "string" ? FORECAST_URL_RAW.trim() : "";
const FORECAST_ENABLED = (process.env.FORECAST_ENABLED || "").toLowerCase() === "true";
const WEATHER_MEDIA_REFRESH_INTERVAL_MS = 60 * 60 * 1000;
const WEATHER_MEDIA_TARGET = "previsaodotempo";
const WEATHER_API_ENABLED = process.env.ENABLE_WEATHER_API === "true";
const MAX_STATS = 5000;
const MAX_PROMOS = 200;
const STATS_FLUSH_INTERVAL_MS = 1500;
const WEATHER_LOG_WINDOW_MS = 10 * 60 * 1000;
const WEATHER_CIRCUIT_BREAKER_MS = 30 * 60 * 1000;
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || "30", 10) || 30;
const MAX_CAROUSEL_ITEMS = parseInt(process.env.MAX_CAROUSEL_ITEMS || "20", 10) || 20;
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const SUPPORTED_EVENT_TYPES = new Set([
  "video_started",
  "video_completed",
  "connect_clicked",
  "auth_redirect",
  "download_clicked",
  "share_clicked",
]);

const metrics = {
  requests_total: 0,
  uploads_total: 0,
  stream_206_total: 0,
  stream_304_total: 0,
  errors_total: 0,
};

const ensureNumber = (value) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;
const readWeatherCallRecord = () => {
  try {
    if (!fs.existsSync(weatherCallRecordFile)) return { lastCall: 0, lastSuccess: 0 };
    const raw = fs.readFileSync(weatherCallRecordFile, "utf8");
    if (!raw) return { lastCall: 0, lastSuccess: 0 };
    const parsed = JSON.parse(raw);
    return {
      lastCall: ensureNumber(parsed?.lastCall),
      lastSuccess: ensureNumber(parsed?.lastSuccess),
    };
  } catch (error) {
    console.warn("Falha ao ler registro de chamadas da previsão:", error.message);
    return { lastCall: 0, lastSuccess: 0 };
  }
};
const writeWeatherCallRecord = () => {
  try {
    fs.writeFileSync(
      weatherCallRecordFile,
      JSON.stringify({
        lastCall: lastWeatherApiCallAt,
        lastSuccess: lastWeatherSuccessAt,
      }),
      "utf8"
    );
  } catch (error) {
    console.warn("Falha ao gravar registro de chamadas da previsão:", error.message);
  }
};

const openaiKey = process.env.OPENAI_API_KEY;
let openai = null;
if (openaiKey) {
  openai = new OpenAI({ apiKey: openaiKey });
} else {
  console.warn("OPENAI_API_KEY não definido; rota /api/cotacoes-agro ficará indisponível.");
}
// O deploy deve definir: OPENAI_API_KEY=<sua-chave-da-openai>

let cachedQuotes = null;
let cachedAt = 0;
const CACHE_MS = 15 * 60 * 1000; // 15 minutos
let cachedWeather = null;
let cachedWeatherAt = 0;
const WEATHER_CACHE_MS = 60 * 60 * 1000; // 1 hora
const WEATHER_FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutos
const WEATHER_API_CALL_INTERVAL_MS = 60 * 60 * 1000; // 1 hora
let lastWeatherApiCallAt = 0;
let lastWeatherSuccessAt = 0;
let lastForecastSkip = false;
const weatherLogState = new Map();
let weatherCircuitOpenUntil = 0;

const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers["x-request-id"] || randomUUID(),
});
({
  lastCall: lastWeatherApiCallAt,
  lastSuccess: lastWeatherSuccessAt,
} = readWeatherCallRecord());
let weatherFailureCooldownUntil = 0;
let cachedScores = null;
let cachedScoresAt = 0;
const CACHE_SCORES_MS = 2 * 60 * 1000;
let cachedCattle = null;
let cachedCattleAt = 0;
const CACHE_CATTLE_MS = 10 * 60 * 1000; // 10 minutos
const CATTLE_CATEGORIES = [
  "Boi gordo (castrado)",
  "Boi gordo inteiro",
  "Boi China / Exportação",
  "Boi Europa / Angus / Premium",
  "Boi comum (à vista)",
  "Boi comum (a prazo)",
  "Novilho",
  "Novilho precoce",
  "Novilho superprecoce",
  "Vaca gorda",
  "Vaca boa / exportação",
  "Vaca comum",
  "Novilha gorda",
  "Novilha precoce",
];

const padTwo = (value) => value.toString().padStart(2, "0");
const getLocalDateTimeInfo = () => {
  const now = new Date();
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absMinutes = Math.abs(offsetMinutes);
  const hoursOffset = Math.floor(absMinutes / 60);
  const minutesOffset = absMinutes % 60;
  return {
    iso: now.toISOString(),
    localDate: now.toISOString().slice(0, 10),
    localTime: `${padTwo(now.getHours())}:${padTwo(now.getMinutes())}`,
    timezoneLabel: `${sign}${padTwo(hoursOffset)}:${padTwo(minutesOffset)}`,
  };
};

const cleanOpenAIOutput = (text) => {
  if (!text) return "";
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    return codeBlockMatch[1].trim();
  }
  const cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const firstBrace = cleaned.indexOf("{");
  if (firstBrace >= 0) {
    return cleaned.slice(firstBrace).trim();
  }
  return cleaned;
};

// Extensões permitidas (vídeo e imagens) para o portal cativo.
const ALLOWED_EXT = [".mp4", ".jpg", ".jpeg", ".png", ".webp"];
const MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`Falha ao criar diretório ${dir}:`, error.message);
    throw error;
  }
};

ensureDir(mediaDir);
ensureDir(screenshotDir);
ensureDir(rotatedMediaDir);
if (fs.existsSync(legacyRotatedMediaDir)) {
  ensureDir(legacyRotatedMediaDir);
}

// TVs configuráveis para Roku.

const normalizeTarget = (value) => {
  const val = typeof value === "string" ? value.trim().toLowerCase() : "";
  return val || "todas";
};
const targetSuffix = (value) => {
  const normalized = normalizeTarget(value);
  return normalized === "todas" ? "" : `-${slugifyId(normalized)}`;
};
const ensureVisivelValue = (value, target) => {
  if (typeof value === "boolean") return value;
  const defaultVisible = target === WEATHER_MEDIA_TARGET ? false : true;
  return defaultVisible;
};
const normalizeItems = (items = []) =>
  Array.isArray(items)
    ? items.map((item) => {
        const normalizedTarget = normalizeTarget(item?.target);
        return {
          ...item,
          target: normalizedTarget,
          visivel: ensureVisivelValue(item?.visivel, normalizedTarget),
        };
      })
    : [];

const buildAggregateEntry = (targets = {}) => {
  const aggregated = {
    mode: "video",
    items: [],
    target: "todas",
    updatedAt: Date.now(),
  };
  let modeCandidate = "";
  Object.values(targets).forEach((entry) => {
    if (!entry) return;
    if (!modeCandidate && entry.mode) {
      modeCandidate = entry.mode;
    }
    aggregated.items.push(...(entry.items || []));
  });
  aggregated.mode = modeCandidate || "video";
  return aggregated;
};

const collectReferencedFilenames = (entries = []) => {
  const keep = new Set();
  (entries || []).forEach((item) => {
    const name = item?.path ? path.basename(item.path) : "";
    if (name) keep.add(name);
  });
  return Array.from(keep);
};
const rotateMp4Clockwise = (sourcePath, destPath) =>
  new Promise((resolve, reject) => {
    const args = [
      "-i",
      sourcePath,
      "-vf",
      "transpose=1",
      "-c:v",
      "libx264",
      "-c:a",
      "copy",
      "-movflags",
      "+faststart",
      "-y",
      destPath,
    ];
    execFile(ffmpegPath, args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        const message =
          stderr && stderr.trim()
            ? `ffmpeg stderr: ${stderr
                .trim()
                .split("\n")
                .slice(-3)
                .join(" | ")}`
            : error.message;
        return reject(new Error(`Falha ao rotacionar vídeo: ${message}`));
      }
      resolve();
    });
  });
const slugifyId = (value) =>
  (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w-]+/g, "")
    .slice(0, 120);

const resolveMediaPath = (mediaPath) => {
  if (!mediaPath || typeof mediaPath !== "string") return null;
  let cleaned = mediaPath.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return null;
  if (cleaned.startsWith("/")) cleaned = cleaned.slice(1);
  if (cleaned.startsWith("media/")) cleaned = cleaned.slice("media/".length);
  if (!cleaned) return null;
  return path.join(mediaDir, cleaned);
};

const buildEtagForStats = (stats) =>
  `W/"${stats.size}-${Math.floor(stats.mtimeMs || 0)}"`;

const isNotModified = (req, etag, lastModifiedMs) => {
  const ifNoneMatch = req.headers["if-none-match"];
  if (ifNoneMatch && ifNoneMatch.includes(etag)) return true;
  const ifModifiedSince = req.headers["if-modified-since"];
  if (ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since) && since >= lastModifiedMs) return true;
  }
  return false;
};

const parseRangeHeader = (rangeHeader, size) => {
  if (!rangeHeader || !rangeHeader.startsWith("bytes=")) return null;
  const raw = rangeHeader.replace("bytes=", "").trim();
  const [startStr, endStr] = raw.split("-");
  let start = startStr ? parseInt(startStr, 10) : NaN;
  let end = endStr ? parseInt(endStr, 10) : NaN;

  if (!Number.isNaN(start) && start < 0) start = NaN;
  if (!Number.isNaN(end) && end < 0) end = NaN;

  if (Number.isNaN(start)) {
    if (Number.isNaN(end)) return null;
    const suffixLength = end;
    if (suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    if (Number.isNaN(end) || end >= size) end = size - 1;
  }

  if (start > end || start < 0 || end < 0 || start >= size) return null;
  return { start, end };
};

const getMediaCacheControl = (req, absPath) => {
  const url = req?.originalUrl || "";
  const hasVersion =
    !!(req && req.query && (req.query.v || req.query.t)) ||
    url.includes("?v=") ||
    url.includes("&v=") ||
    url.includes("?t=") ||
    url.includes("&t=");
  if (hasVersion) {
    return "public, max-age=31536000, immutable";
  }
  const baseName = path.basename(absPath || "").toLowerCase();
  if (baseName.startsWith("latest")) {
    return "public, max-age=0, must-revalidate";
  }
  return "public, max-age=300";
};

const sendFileWithRange = (req, res, absPath, mime, options = {}) => {
  if (!absPath || !fs.existsSync(absPath)) {
    return res.sendStatus(404);
  }
  const stats = fs.statSync(absPath);
  if (!stats.isFile()) return res.sendStatus(404);

  const cacheControl = options.cacheControl || getMediaCacheControl(req, absPath);
  const etag = buildEtagForStats(stats);
  const lastModified = new Date(stats.mtimeMs || Date.now()).toUTCString();

  res.setHeader("Content-Type", mime || "application/octet-stream");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", cacheControl);
  res.setHeader("ETag", etag);
  res.setHeader("Last-Modified", lastModified);
  res.setHeader("Vary", "Accept-Encoding");

  if (isNotModified(req, etag, stats.mtimeMs || 0)) {
    metrics.stream_304_total += 1;
    return res.status(304).end();
  }

  const rangeHeader = req.headers.range;
  if (rangeHeader) {
    const range = parseRangeHeader(rangeHeader, stats.size);
    if (!range) {
      res.setHeader("Content-Range", `bytes */${stats.size}`);
      return res.status(416).end();
    }
    const { start, end } = range;
    const chunkSize = end - start + 1;
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stats.size}`);
    res.setHeader("Content-Length", chunkSize);
    metrics.stream_206_total += 1;
    if (req.method === "HEAD") return res.end();
    return fs.createReadStream(absPath, { start, end }).pipe(res);
  }

  res.setHeader("Content-Length", stats.size);
  if (req.method === "HEAD") return res.end();
  return fs.createReadStream(absPath).pipe(res);
};

const sendLatestMedia = (req, res) => {
  const config = readMediaConfig();
  if (config?.items?.length) {
    const primary = config.items[0];
    const filePath = resolveMediaPath(primary.path);
    if (!filePath || !fs.existsSync(filePath)) return res.sendStatus(404);
    return sendFileWithRange(req, res, filePath, primary.mime, {
      cacheControl: "public, max-age=0, must-revalidate",
    });
  }

  const latest = findLatestFile();
  if (!latest) return res.sendStatus(404);
  return sendFileWithRange(req, res, latest.fullPath, latest.mime, {
    cacheControl: "public, max-age=0, must-revalidate",
  });
};

const handleMediaRequest = (req, res) => {
  const relPath = req.path.replace(/^\/media\/?/, "");
  if (!relPath) return res.sendStatus(404);
  if (relPath === "latest") {
    return sendLatestMedia(req, res);
  }
  const absPath = path.resolve(mediaDir, relPath);
  if (!absPath.startsWith(mediaDir)) {
    return sendJsonError(res, 400, "INVALID_PATH", "Caminho de mídia inválido.");
  }
  const ext = path.extname(absPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || "application/octet-stream";
  return sendFileWithRange(req, res, absPath, mime);
};

const storageSingle = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mediaDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const isVideo = ext === ".mp4";
    const targetSegment = targetSuffix(_req.body?.target);
    const baseName = isVideo ? `latest${targetSegment}` : `latest-image${targetSegment}`;
    cb(null, `${baseName}${ext}`);
  },
});

const storageCarousel = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, mediaDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const unique = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const targetSegment = targetSuffix(_req.body?.target);
    cb(null, `carousel${targetSegment}-${unique}${ext}`);
  },
});

const upload = multer({
  storage: storageSingle,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    const isVideo = ext === ".mp4";
    const isImage = isImageExt(ext);
    if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME_TYPES.has(mime)) {
      const err = new Error("Tipo de arquivo não suportado.");
      err.statusCode = 415;
      err.errorCode = "INVALID_MIME";
      return cb(err);
    }
    if (isVideo && mime !== "video/mp4") {
      const err = new Error("Apenas vídeo MP4 é aceito.");
      err.statusCode = 415;
      err.errorCode = "INVALID_MIME";
      return cb(err);
    }
    if (!isVideo && !isImage) {
      const err = new Error("Apenas imagens (jpg/png/webp) são aceitas.");
      err.statusCode = 415;
      err.errorCode = "INVALID_MIME";
      return cb(err);
    }
    cb(null, true);
  },
});

const uploadCarousel = multer({
  storage: storageCarousel,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    const mime = (file.mimetype || "").toLowerCase();
    if (!isImageExt(ext) || !ALLOWED_MIME_TYPES.has(mime) || mime === "video/mp4") {
      const err = new Error("Apenas imagens (jpg/png/webp) são aceitas no carrossel.");
      err.statusCode = 415;
      err.errorCode = "INVALID_MIME";
      return cb(err);
    }
    cb(null, true);
  },
});

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMITED", message: "Muitas requisições. Tente mais tarde." },
});

const extrasLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMITED", message: "Muitas requisições. Tente mais tarde." },
});

const rawCorsOrigins = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
const allowedCorsOrigins = rawCorsOrigins
  .split(/[;,]/)
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowAllCors = process.env.NODE_ENV === "development" && allowedCorsOrigins.length === 0;
const corsOptions = {
  origin: (origin, callback) => {
    if (allowAllCors || rawCorsOrigins === "*") return callback(null, true);
    if (!origin) return callback(null, true);
    if (allowedCorsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado"));
  },
};

app.set("trust proxy", process.env.TRUST_PROXY || "loopback");
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(requestLogger);
app.use((req, res, next) => {
  res.setHeader("X-Request-Id", req.id);
  metrics.requests_total += 1;
  res.on("finish", () => {
    if (res.statusCode >= 400) metrics.errors_total += 1;
  });
  next();
});
app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());
app.get("/media/*", handleMediaRequest);
app.head("/media/*", handleMediaRequest);
app.use(express.static(path.join(__dirname), { maxAge: 0 }));

const findLatestFile = () => {
  try {
    const config = readMediaConfig();
    const items = Array.isArray(config?.items) ? config.items : [];
    if (items.length) {
      const sorted = [...items].sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      for (const item of sorted) {
        const resolved = resolveMediaPath(item.path);
        if (!resolved || !fs.existsSync(resolved)) continue;
        const ext = path.extname(resolved).toLowerCase();
        return {
          name: path.basename(resolved),
          fullPath: resolved,
          mime: item.mime || MIME_BY_EXT[ext] || "application/octet-stream",
        };
      }
    }
  } catch (error) {
    console.warn("Falha ao buscar mídia pelo media-config.json:", error.message);
  }

  const files = fs.readdirSync(mediaDir);
  const candidates = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return file.startsWith("latest") && ALLOWED_EXT.includes(ext);
  });
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const aStats = fs.statSync(path.join(mediaDir, a));
    const bStats = fs.statSync(path.join(mediaDir, b));
    return aStats.mtimeMs - bStats.mtimeMs;
  });
  const name = candidates[candidates.length - 1];
  const ext = path.extname(name).toLowerCase();
  return {
    name,
    fullPath: path.join(mediaDir, name),
    mime: MIME_BY_EXT[ext] || "application/octet-stream",
  };
};

const readStatsFromDisk = () => {
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

let statsCache = readStatsFromDisk();
let statsFlushTimer = null;
let statsFlushRunning = false;

const getStatsSnapshot = () => (Array.isArray(statsCache) ? [...statsCache] : []);

const flushStatsToDisk = async () => {
  statsFlushTimer = null;
  if (statsFlushRunning) return;
  statsFlushRunning = true;
  const trimmed = statsCache.slice(-MAX_STATS);
  statsCache = trimmed;
  try {
    await fs.promises.writeFile(statsFile, JSON.stringify(trimmed, null, 2));
  } catch (error) {
    console.error("Erro ao gravar stats.json:", error.message);
  } finally {
    statsFlushRunning = false;
  }
};

const scheduleStatsFlush = () => {
  if (statsFlushTimer) return;
  statsFlushTimer = setTimeout(flushStatsToDisk, STATS_FLUSH_INTERVAL_MS);
};

const safeStr = (value, max = 256) => (typeof value === "string" ? value.slice(0, max) : "");
const sendJsonError = (res, status, error, message) =>
  res.status(status).json({ ok: false, error, message });

// Middleware simples para exigir senha no upload. Use a variável de ambiente UPLOAD_PASSWORD para trocar o valor.
const requireUploadAuth = (req, res, next) => {
  const secret = process.env.UPLOAD_PASSWORD;
  const provided = req.headers["x-upload-password"];
  if (!secret) {
    return sendJsonError(res, 500, "UPLOAD_PASSWORD_MISSING", "Senha de upload não configurada no servidor.");
  }
  if (provided !== secret) {
    return sendJsonError(res, 401, "UPLOAD_UNAUTHORIZED", "Senha inválida para upload.");
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
const buildMediaItemUrl = (item, fallbackUpdatedAt) => {
  if (!item?.path) return "";
  const version = Math.floor(item.updatedAt || fallbackUpdatedAt || Date.now());
  return `${item.path}?v=${version}`;
};
const enrichMediaItem = (item, fallbackUpdatedAt, fallbackTarget) => {
  const updatedAt = item.updatedAt || fallbackUpdatedAt || Date.now();
  return {
    ...item,
    target: normalizeTarget(item.target || fallbackTarget),
    updatedAt,
    url: item.url || buildMediaItemUrl(item, updatedAt),
  };
};

const readMediaConfig = () => {
  try {
    if (!fs.existsSync(mediaConfigFile)) return { targets: {} };
    const raw = fs.readFileSync(mediaConfigFile, "utf8");
    if (!raw) return { targets: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { targets: {} };
    const targetsRaw = parsed.targets || {};
    const targets = {};
    Object.entries(targetsRaw).forEach(([key, entry]) => {
      const normalizedKey = normalizeTarget(key);
      targets[normalizedKey] = {
        ...entry,
        target: normalizedKey,
        items: normalizeItems(entry?.items),
      };
    });
    const aggregate = buildAggregateEntry(targets);
    return {
      ...parsed,
      targets,
      items: aggregate.items,
      mode: aggregate.mode,
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch (error) {
    console.warn("Erro ao ler media-config.json:", error.message);
    return { targets: {} };
  }
};

const buildMediaManifestPayload = (requestedTarget) => {
  const target = normalizeTarget(requestedTarget);
  const config = readMediaConfig();
  const configUpdatedAt = config.updatedAt || Date.now();
  let entry = null;

  if (target === "todas" && Array.isArray(config.items) && config.items.length) {
    entry = {
      target,
      mode: config.mode || "video",
      items: config.items,
      updatedAt: configUpdatedAt,
    };
  } else if (config.targets?.[target]?.items?.length) {
    entry = {
      ...config.targets[target],
      target,
      updatedAt: config.targets[target].updatedAt || configUpdatedAt,
    };
  }

  if (!entry || !entry.items?.length) {
    const latest = findLatestFile();
    if (!latest) return null;
    const stats = fs.statSync(latest.fullPath);
    const fallbackItem = {
      path: `/media/${latest.name}`,
      mime: latest.mime,
      size: stats.size,
      updatedAt: stats.mtimeMs,
      target,
      visivel: ensureVisivelValue(undefined, target),
      ...applyDisplayMetadata(target),
    };
    entry = {
      target,
      mode: "video",
      items: [fallbackItem],
      updatedAt: stats.mtimeMs,
    };
  }

  const updatedAt =
    entry.updatedAt ||
    entry.items.reduce((max, item) => Math.max(max, item?.updatedAt || 0), 0) ||
    configUpdatedAt;
  const items = entry.items.map((item) => enrichMediaItem(item, updatedAt, target));
  const primary = items[0] || null;
  const etag = `W/"${target}:${updatedAt}:${items.length}"`;
  const lastModified = new Date(updatedAt).toUTCString();

  return {
    etag,
    lastModified,
    data: {
      ok: true,
      target,
      mode: entry.mode || "video",
      updatedAt,
      items,
      url: primary?.url,
      path: primary?.path,
      mime: primary?.mime,
      size: primary?.size,
      configUpdatedAt: entry.updatedAt || configUpdatedAt,
    },
  };
};

const writeMediaConfig = (target, mode, items = [], replaceAll = false) => {
  const current = readMediaConfig();
  const normalizedTarget = normalizeTarget(target);
  const baseTargets = {};
  Object.entries(current.targets || {}).forEach(([key, value]) => {
    if (key === normalizedTarget) return;
    baseTargets[key] = value;
  });
  const nextTargets = replaceAll ? {} : { ...baseTargets };
  const safeItems = normalizeItems(items);
  nextTargets[normalizedTarget] = {
    mode,
    items: safeItems,
    target: normalizedTarget,
    updatedAt: Date.now(),
  };
  const aggregate = buildAggregateEntry(nextTargets);
  const nextConfig = {
    ...current,
    targets: nextTargets,
    items: aggregate.items,
    mode: aggregate.mode,
    updatedAt: Date.now(),
  };
  try {
    fs.writeFileSync(mediaConfigFile, JSON.stringify(nextConfig, null, 2));
  } catch (error) {
    console.error("Erro ao gravar media-config.json:", error.message);
    throw error;
  }
  return nextConfig;
};

const setWeatherTargetVisibility = (visible) => {
  const config = readMediaConfig();
  const entry = config.targets?.[WEATHER_MEDIA_TARGET];
  if (!entry || !Array.isArray(entry.items)) return null;
  const mode = entry.mode || "image";
  const alreadyMatching = entry.items.every((item) => item.visivel === visible);
  if (alreadyMatching) return entry;
  const updatedItems = entry.items.map((item) => ({
    ...item,
    visivel: ensureVisivelValue(visible, WEATHER_MEDIA_TARGET),
  }));
  return writeMediaConfig(WEATHER_MEDIA_TARGET, mode, updatedItems);
};

const markWeatherTargetFailure = () => {
  setWeatherTargetVisibility(false);
  lastWeatherSuccessAt = 0;
  writeWeatherCallRecord();
  weatherFailureCooldownUntil = Date.now() + WEATHER_FAILURE_COOLDOWN_MS;
};

const resetWeatherFailureState = () => {
  weatherFailureCooldownUntil = 0;
};

const logWeatherWarnOnce = (key, message, everyMs = WEATHER_LOG_WINDOW_MS) => {
  const now = Date.now();
  const last = weatherLogState.get(key) || 0;
  if (now - last >= everyMs) {
    console.warn(message);
    weatherLogState.set(key, now);
  }
};

const canCallWeatherApi = () =>
  lastWeatherApiCallAt === 0 || Date.now() - lastWeatherApiCallAt >= WEATHER_API_CALL_INTERVAL_MS;
const recordWeatherApiCall = () => {
  lastWeatherApiCallAt = Date.now();
  writeWeatherCallRecord();
};
const recordWeatherSuccess = () => {
  lastWeatherSuccessAt = Date.now();
  writeWeatherCallRecord();
};

const applyWeatherVisibilityStateFromRecord = () => {
  setWeatherTargetVisibility(lastWeatherSuccessAt > 0);
};
applyWeatherVisibilityStateFromRecord();

// Gera a base pública para links do Roku (usa PUBLIC_BASE_URL ou host do request).
const resolvePublicBaseUrl = (req) => {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, "");
  if (!req) return "";
  const host = req.get("x-forwarded-host") || req.get("host");
  if (!host) return "";
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  return `${proto}://${host}`.replace(/\/+$/, "");
};

// TVs configuráveis para Roku
const readTvConfig = () => {
  try {
    if (!fs.existsSync(tvConfigFile)) return [];
    const raw = fs.readFileSync(tvConfigFile, "utf8");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Erro ao ler tv-config.json:", error.message);
    return [];
  }
};

const writeTvConfig = (tvs) => {
  const safe = Array.isArray(tvs) ? tvs : [];
  try {
    fs.writeFileSync(tvConfigFile, JSON.stringify(safe, null, 2));
  } catch (error) {
    console.error("Erro ao gravar tv-config.json:", error.message);
    throw error;
  }
  return safe;
};

const normalizeTvPayload = (body = {}, keepId = false) => {
  const nome = safeStr(body.nome || body.name || "", 160);
  const marca = safeStr(body.marca || body.brand || "", 160);
  const tipo = normalizeTarget(body.tipo || nome);
  const baseId = body.id ? safeStr(body.id, 120) : slugifyId(`${nome}-${marca}` || nome);
  const id = keepId ? baseId : slugifyId(baseId || nome || marca);
  return { id, nome, tipo, marca };
};

const applyDisplayMetadata = (target, overrides = {}) => {
  const base = {
    exibicao: overrides.exibicao ?? "10s",
    intervalo:
      overrides.intervalo ??
      (normalizeTarget(target) === WEATHER_MEDIA_TARGET ? "5m" : ""),
  };
  return { ...base, ...overrides };
};

const summarizeFile = (fileName, target = "todas") => {
  const fullPath = path.join(mediaDir, fileName);
  const stats = fs.statSync(fullPath);
  const ext = (path.extname(fileName) || "").toLowerCase();
  const normalizedTarget = normalizeTarget(target);
  return {
    path: `/media/${fileName}`,
    mime: getMimeFromExt(ext),
    size: stats.size,
    updatedAt: stats.mtimeMs,
    target: normalizedTarget,
    visivel: ensureVisivelValue(undefined, normalizedTarget),
    ...applyDisplayMetadata(target),
  };
};

const cleanupKeeping = (keepList) => {
  const keepSet = new Set(keepList);
  const files = fs.readdirSync(mediaDir);
  for (const file of files) {
    const filePath = path.join(mediaDir, file);
    try {
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) continue;
    } catch (statError) {
      console.warn(`Não foi possível ler ${file} para limpeza:`, statError.message);
      continue;
    }
    if (keepSet.has(file)) continue;
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      console.warn(`Não foi possível remover ${file}:`, error.message);
    }
  }
};

const getRandom = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const EXTRAS_CACHE = {
  weather: { updatedAt: 0, data: null },
  commodities: { updatedAt: 0, data: null },
  scores: { updatedAt: 0, data: null },
};

const buildForecast = () =>
  ["Hoje", "Amanhã", "Depois"].map((label) => ({
    day: label,
    high: getRandom(25, 35),
    low: getRandom(18, 24),
  }));

const refreshWeather = () => {
  EXTRAS_CACHE.weather.data = {
    ok: true,
    location: "Centro de Distribuição",
    current: getRandom(22, 33),
    summary: "Parcialmente nublado com chance de chuva à tarde",
    forecast: buildForecast(),
    updatedAt: new Date().toLocaleTimeString("pt-BR"),
  };
  EXTRAS_CACHE.weather.updatedAt = Date.now();
};

const refreshCommodities = () => {
  const samples = [
    ["Café", "R$ 820,00", "+1,2%"],
    ["Leite", "R$ 3,10", "+0,4%"],
    ["Soja", "R$ 190,20", "-0,3%"],
    ["Milho", "R$ 124,70", "+0,9%"],
    ["Carne bovina", "R$ 28,50", "+1,6%"],
    ["Carne suína", "R$ 12,30", "+0,8%"],
    ["Ave", "R$ 11,80", "-0,1%"],
  ];
  EXTRAS_CACHE.commodities.data = {
    ok: true,
    market: "Bolsa Agro Brasil",
    updatedAt: new Date().toLocaleTimeString("pt-BR"),
    items: samples.map(([label, price, change]) => ({ label, price, change })),
  };
  EXTRAS_CACHE.commodities.updatedAt = Date.now();
};

const buildScoreEntry = (options) => ({
  league: options.league,
  home: options.home,
  away: options.away,
  scoreHome: typeof options.scoreHome === "number" ? options.scoreHome : options.scoreHome || 0,
  scoreAway: typeof options.scoreAway === "number" ? options.scoreAway : options.scoreAway || 0,
  status: options.status || "Pendente",
});

const mockScores = [
  { league: "Brasileirão Série A", home: "Flamengo", away: "Palmeiras", scoreHome: 2, scoreAway: 2, status: "2º tempo" },
  { league: "Brasileirão Série B", home: "Bahia", away: "Cruzeiro", scoreHome: 1, scoreAway: 0, status: "Finalizado" },
  { league: "Copa do Brasil", home: "Atlético-MG", away: "Grêmio", scoreHome: 3, scoreAway: 1, status: "Finalizado" },
  { league: "Libertadores", home: "Internacional", away: "River Plate", scoreHome: 1, scoreAway: 1, status: "2º tempo" },
  { league: "Copa Sul-Americana", home: "Fluminense", away: "Nacional", scoreHome: 0, scoreAway: 0, status: "Intervalo" },
  { league: "Mundial de Clubes", home: "Corinthians", away: "Real Madrid", scoreHome: 1, scoreAway: 2, status: "Finalizado" },
];

const refreshScores = async () => {
  const matchesSource = "mock";
  const matches = mockScores.map((entry) => buildScoreEntry(entry));
  console.log(`[scores] usando dados de ${matchesSource}.`);
  const leagues = Array.from(new Set(matches.map((match) => match.league).filter(Boolean)));
  EXTRAS_CACHE.scores.data = {
    ok: true,
    league: leagues[0] || "Brasileirão Série A",
    leagues,
    updatedAt: new Date().toLocaleTimeString("pt-BR"),
    matches,
  };
  EXTRAS_CACHE.scores.updatedAt = Date.now();
};

const touchCache = async (key, refresher) => {
  const cache = EXTRAS_CACHE[key];
  if (!cache) return null;
  if (Date.now() - cache.updatedAt > 5 * 60 * 1000 || !cache.data) {
    await refresher();
  }
  return cache.data;
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

const isWeatherPortraitFresh = (stats) =>
  stats && Date.now() - stats.mtimeMs < WEATHER_PORTRAIT_CACHE_MS;

const ensureWeatherPortraitReady = async (baseUrl) => {
  if (!baseUrl) throw new Error("Base pública não definida para gerar o retrato.");
  if (!WEATHER_API_ENABLED) {
    throw new Error("Previsão desativada no servidor.");
  }
  if (fs.existsSync(weatherPortraitPath)) {
    const existing = fs.statSync(weatherPortraitPath);
    if (isWeatherPortraitFresh(existing)) {
      return existing;
    }
  }

  if (!weatherPortraitPromise) {
    weatherPortraitPromise = renderWeatherPortrait({
      baseUrl,
      outPath: weatherPortraitPath,
    }).finally(() => {
      weatherPortraitPromise = null;
    });
  }

  await weatherPortraitPromise;
  return fs.statSync(weatherPortraitPath);
};

const updateWeatherMediaTarget = () => {
  if (!fs.existsSync(weatherPortraitPath)) {
    console.warn("Retrato do tempo ainda não gerado; aguardando próxima tentativa.");
    return null;
  }
  const relativePath = path.relative(mediaDir, weatherPortraitPath);
  if (!relativePath || relativePath.includes("..")) {
    console.warn("Caminho do retrato do tempo inválido:", weatherPortraitPath);
    return null;
  }
  const item = summarizeFile(relativePath, WEATHER_MEDIA_TARGET);
  item.visivel = true;
  try {
    const nextConfig = writeMediaConfig(WEATHER_MEDIA_TARGET, "image", [item]);
    resetWeatherFailureState();
    recordWeatherSuccess();
    return nextConfig;
  } catch (error) {
    console.error("Erro ao atualizar media-config.json com previsão:", error.message);
    return null;
  }
};

const triggerForecastRefresh = async () => {
  if (!FORECAST_ENABLED || !FORECAST_URL) return null;
  const base = FORECAST_URL.trim();
  if (!base) return null;
  if (typeof fetch !== "function") {
    logWeatherWarnOnce(
      "forecast-fetch-missing",
      "fetch não disponível no ambiente; a previsão não será solicitada automaticamente."
    );
    return null;
  }
  const url = `${base}${base.includes("?") ? "&" : "?"}_=${Date.now()}`;
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (response.status === 404) {
      logWeatherWarnOnce(
        "forecast-404",
        `[forecast-refresh] 404 em ${base}; mantendo mídia existente.`,
        WEATHER_LOG_WINDOW_MS
      );
      lastForecastSkip = true;
      return null;
    }
    if (response.status === 503 || response.status >= 500) {
      const statusKey = response.status === 503 ? "forecast-503" : "forecast-5xx";
      logWeatherWarnOnce(
        statusKey,
        `[forecast-refresh] ${response.status} em ${base}; mantendo mídia existente.`,
        WEATHER_LOG_WINDOW_MS
      );
      lastForecastSkip = true;
      return null;
    }
    lastForecastSkip = false;
    if (!response.ok) {
      throw new Error(`status ${response.status} ${response.statusText}`);
    }
  } catch (error) {
    logWeatherWarnOnce(
      "forecast-error",
      `[forecast-refresh] falha ao chamar ${base}: ${error.message || "erro"}`
    );
    lastForecastSkip = true;
    return null;
  }
  return null;
};

const refreshWeatherMediaAssets = async () => {
  if (!WEATHER_API_ENABLED) {
    console.warn("Atualização automática da previsão desativada (ENABLE_WEATHER_API != true).");
    return null;
  }
  await triggerForecastRefresh();
  if (lastForecastSkip) {
    return null;
  }
  await ensureWeatherPortraitReady(WEATHER_MEDIA_BASE_URL);
  const updated = updateWeatherMediaTarget();
  if (!updated) {
    throw new Error("Falha ao atualizar o target de previsão do tempo.");
  }
  return updated;
};

const scheduleWeatherMediaRefresh = () => {
  if (!WEATHER_MEDIA_BASE_URL) {
    console.warn("Base da mídia do tempo indefinida; desabilitando atualização automática.");
    return;
  }
  if (!FORECAST_ENABLED || !FORECAST_URL) {
    logWeatherWarnOnce("forecast-disabled", "[forecast-refresh] desativado por env");
    return;
  }
  if (!WEATHER_API_ENABLED) {
    console.warn("Agendamento automático de previsão desativado via ENABLE_WEATHER_API.");
    return;
  }
  const runner = () => {
    if (Date.now() < weatherFailureCooldownUntil) return;
    refreshWeatherMediaAssets().catch((error) => {
      logWeatherWarnOnce(
        "weather-refresh",
        `Erro ao atualizar mídia do tempo: ${error.message || "erro"}`
      );
      if (!fs.existsSync(weatherPortraitPath)) {
        markWeatherTargetFailure();
      }
    });
  };
  runner();
  setInterval(runner, WEATHER_MEDIA_REFRESH_INTERVAL_MS);
};

// Feed de Roku: gera dinamicamente por tipo de TV (todas ou tipos definidos) com fallback para arquivo txt legado.
app.get("/api/roku/tvs", (_req, res) => {
  try {
    const tvs = readTvConfig();
    return res.json({ ok: true, tvs });
  } catch (error) {
    console.error("Erro ao listar TVs:", error.message);
    return res.status(500).json({ ok: false, tvs: [] });
  }
});

app.get("/api/roku/weather-portrait", async (req, res) => {
  if (!WEATHER_API_ENABLED) {
    if (!fs.existsSync(weatherPortraitPath)) {
      return res.status(503).json({ ok: false, error: "Previsão desativada no servidor." });
    }
  }

  if (!fs.existsSync(weatherPortraitPath)) {
    return res
      .status(404)
      .json({ ok: false, error: "Retrato do tempo ainda não disponível." });
  }

  try {
    const st = fs.statSync(weatherPortraitPath);
    const timestamp = Math.floor(st.mtimeMs || Date.now());
    return res.json({
      ok: true,
      url: `/media/screenshots/${WEATHER_PORTRAIT_FILENAME}?v=${timestamp}`,
    });
  } catch (error) {
    console.error("Erro ao ler retrato do tempo para Roku:", error.message);
    return res.status(500).json({ ok: false, error: "Erro ao ler retrato do tempo." });
  }
});

app.get("/api/cotacoes-agro", extrasLimiter, async (_req, res) => {
  // Retorna cotações agro via OpenAI + busca web; cache de 15 min
  if (!openai) {
    console.warn("[cotacoes-agro] requisição sem OpenAI key configurada.");
    return res.status(503).json({ error: "Chave OPENAI_API_KEY ausente; rota indisponível." });
  }
  if (cachedQuotes && Date.now() - cachedAt < CACHE_MS) {
    return res.json(cachedQuotes);
  }

  const { localDate, localTime, timezoneLabel } = getLocalDateTimeInfo();
  const prompt = `
Data e hora da solicitação: ${localDate} ${localTime} (UTC${timezoneLabel})
Quero as cotações ATUAIS no Brasil para os itens abaixo, priorizando a região de Seringueiras – Rondônia:

1. Café arábica (saca 60kg)
2. Soja (saca 60kg)
3. Milho (saca 60kg)
4. Boi gordo (arroba)
5. Suíno (kg vivo ou carcaça, mencione qual)
6. Frango/ave (kg, mencione se vivo/atacado/varejo)

Priorize as fontes nesta ordem:
  a) Seringueiras – RO ou praças próximas.
  b) Estado de Rondônia (RO).
  c) Estados próximos (AC, AM, MT, MS, GO).
  d) Preço médio nacional.

Para cada item informe:
  * Valor numérico (não use 0; se não tiver dado confiável, use null).
  * Região consultada (Seringueiras-RO, RO, MT, Brasil etc.).
  * Obs explicando a origem (ex.: "indicador nacional CEPEA").

Responda APENAS com JSON, sem texto extra, no formato:
{
  "dataAtual": "AAAA-MM-DD",
  "fontePrincipal": "string",
  "itens": [
    {
      "nome": "Cafe arabica",
      "unidade": "saca 60kg",
      "preco": 0,
      "regiaoReferencia": "Seringueiras-RO",
      "obs": "texto opcional"
    }
  ]
}

Nunca retorne 0 (zero). Use null apenas quando não houver dado confiável e explique no obs.
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 800,
      tools: [
        {
          type: "web_search_preview",
        },
      ],
    });

    // https://platform.openai.com/docs/api-reference/responses/response-object#response_object-output_text
    const pool =
      response.output_text ||
      (Array.isArray(response.output)
        ? response.output
            .flatMap((block) => block?.content || [])
            .map((item) => item.text || "")
            .join(" ")
        : "");
    const rawOutput = cleanOpenAIOutput(pool);

    if (!rawOutput) {
      console.error("[cotacoes-agro] resposta sem texto");
      return res.status(500).json({ error: "Falha ao obter cotações agro no momento." });
    }

    let json;
    try {
      json = JSON.parse(rawOutput);
    } catch (parseError) {
      console.error("[cotacoes-agro] erro ao parsear JSON:", parseError.message, rawOutput);
      return res.status(500).json({ error: "Falha ao obter cotações agro no momento." });
    }

    const itensSemPreco = json.itens.filter(
      (item) =>
        item.preco === null ||
        item.preco === 0 ||
        typeof item.preco !== "number" ||
        Number.isNaN(item.preco)
    );

    if (itensSemPreco.length > 0) {
      const nomesItens = itensSemPreco
        .map((item) => `- ${item.nome} (${item.unidade || "unidade"})`)
        .join("\n");
      const promptBrasil = `
Data e hora da solicitação (fallback): ${localDate} ${localTime} (UTC${timezoneLabel})
Quero preços MÉDIOS BRASIL para os seguintes itens agropecuários no formato exato indicado.

${nomesItens}

Responda apenas com JSON sem texto extra:
{
  "itens": [
    {
      "nome": "string (mesmo nome que enviei)",
      "unidade": "string (mesma unidade que enviei)",
      "preco": number | null,
      "obs": "string explicando a fonte"
    }
  ]
}

Use preços médios Brasil (indicadores nacionais como CEPEA, Scot, Safras, etc.). Nunca retorne 0; se não houver dado, use null.
`;
      try {
        const responseBrasil = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: promptBrasil,
          max_output_tokens: 600,
          tools: [{ type: "web_search_preview" }],
        });
        const brasilRaw = cleanOpenAIOutput(
          responseBrasil.output_text ||
            (Array.isArray(responseBrasil.output)
              ? responseBrasil.output
                  .flatMap((block) => block?.content || [])
                  .map((item) => item.text || "")
                  .join(" ")
              : "")
        );
        const dataBrasil = JSON.parse(brasilRaw);
        dataBrasil.itens.forEach((itemFallback) => {
          const idx = json.itens.findIndex(
            (orig) =>
              orig.nome === itemFallback.nome && orig.unidade === itemFallback.unidade
          );
          if (idx !== -1) {
            const origItem = json.itens[idx];
            if (
              origItem.preco === null ||
              origItem.preco === 0 ||
              typeof origItem.preco !== "number" ||
              Number.isNaN(origItem.preco)
            ) {
              origItem.preco = itemFallback.preco;
              if (itemFallback.preco !== null && itemFallback.preco !== undefined) {
                origItem.regiaoReferencia = "Brasil";
              }
              const obsOriginal = origItem.obs ? `${origItem.obs} | ` : "";
              origItem.obs =
                obsOriginal + (itemFallback.obs || "Preço médio Brasil (fallback).");
            }
          }
        });
      } catch (fallbackError) {
        console.error("[cotacoes-agro] fallback Brasil falhou:", fallbackError);
      }
    }

    json.itens = json.itens.map((item) => {
      if (item.preco === 0) {
        item.preco = null;
      }
      return item;
    });

    cachedQuotes = json;
    cachedAt = Date.now();
    return res.json(json);
  } catch (error) {
    console.error("[cotacoes-agro] falha:", error);
    return res.status(500).json({ error: "Falha ao obter cotações agro no momento." });
  }
  // Exemplo de JSON retornado:
  // {
  //   "dataAtual": "2025-12-11",
  //   "fontePrincipal": "CEPEA / dados regionais via OpenAI",
  //   "itens": [
  //     {
  //       "nome": "Cafe arabica",
  //       "unidade": "saca 60kg",
  //       "preco": 2258.9,
  //       "regiaoReferencia": "Brasil",
  //       "obs": "Sem dado de Rondônia; indicador nacional."
  //     },
  //     {
  //       "nome": "Milho",
  //       "unidade": "saca 60kg",
  //       "preco": 67.5,
  //       "regiaoReferencia": "RO",
  //       "obs": "Cotação em praça de Rondônia."
  //     }
  //   ]
  // }
});

app.get("/api/cotacoes-gado", async (_req, res) => {
  if (!openai) {
    return res.status(400).json({ error: "OPENAI_API_KEY not set" });
  }

  if (cachedCattle && Date.now() - cachedCattleAt < CACHE_CATTLE_MS) {
    return res.json(cachedCattle);
  }

  const { localDate, localTime, timezoneLabel } = getLocalDateTimeInfo();

  const prompt = `
Data e hora da solicitação: ${localDate} ${localTime} (UTC${timezoneLabel})
Use busca web no Boletim Diário de Preços do Estado de São Paulo e responda apenas com JSON no formato abaixo:
{
  "dataAtual": "AAAA-MM-DD",
  "fontePrincipal": "string",
  "praça": "São Paulo - SP",
  "categorias": [
    {
      "nome": "Boi gordo (castrado)",
      "unidade": "arroba",
      "preco": null,
      "fonte": "string",
      "obs": "string"
    }
  ]
}
Inclua todas as categorias abaixo com os nomes exatos:
${CATTLE_CATEGORIES.join("\n")}
Nunca use preço = 0. Se não encontrar, coloque null e explique no obs.
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 900,
      tools: [{ type: "web_search_preview" }],
    });
    const outputText = cleanOpenAIOutput(
      response.output_text ||
        (Array.isArray(response.output)
          ? response.output
              .flatMap((block) => block?.content || [])
              .map((item) => item.text || "")
              .join(" ")
          : "")
    );
    if (!outputText.trim()) {
      console.error("[cotacoes-gado] resposta sem texto");
      return res.status(500).json({ error: "Falha ao obter cotações de gado." });
    }
    let data;
    try {
      data = JSON.parse(outputText);
    } catch (parseError) {
      console.error("[cotacoes-gado] parse falhou:", parseError.message, outputText);
      return res.status(500).json({ error: "Falha ao obter cotações de gado." });
    }

    const categoriasPadrao = CATTLE_CATEGORIES.map((nome) => {
      const existente = data.categorias?.find((cat) => cat.nome === nome);
      return (
        existente || {
          nome,
          unidade: "arroba",
          preco: null,
          fonte: "Boletim SP não informou",
          obs: "Categoria não disponível no momento.",
        }
      );
    });
    data.categorias = categoriasPadrao.map((item) => ({
      ...item,
      preco: item.preco === 0 ? null : item.preco,
    }));

    const semPreco = data.categorias.filter((item) => item.preco === null);
    if (semPreco.length) {
      const nomes = semPreco.map((item) => `- ${item.nome}`).join("\n");
      const promptBrasil = `
Data e hora da solicitação (fallback): ${localDate} ${localTime} (UTC${timezoneLabel})
Informe preços médios Brasil (CEPEA/Safras) para as categorias abaixo, respondendo apenas em JSON:
{
  "categorias": [
    {
      "nome": "string",
      "preco": number | null,
      "fonte": "CEPEA - Média Brasil",
      "obs": "Fallback nacional"
    }
  ]
}

${nomes}

Não retorne 0; use null quando não houver dado confiável.
`;
      try {
        const responseBrasil = await openai.responses.create({
          model: "gpt-4.1-mini",
          input: promptBrasil,
          max_output_tokens: 700,
          tools: [{ type: "web_search_preview" }],
        });
        const fallbackText = cleanOpenAIOutput(
          responseBrasil.output_text ||
            (Array.isArray(responseBrasil.output)
              ? responseBrasil.output
                  .flatMap((block) => block?.content || [])
                  .map((item) => item.text || "")
                  .join(" ")
              : "")
        );
        const dataBrasil = JSON.parse(fallbackText);
        dataBrasil.categorias?.forEach((fallback) => {
          const idx = data.categorias.findIndex((orig) => orig.nome === fallback.nome);
          if (idx !== -1 && data.categorias[idx].preco === null) {
            data.categorias[idx].preco = fallback.preco ?? null;
            data.categorias[idx].fonte = fallback.fonte || "CEPEA - Média Brasil";
            data.categorias[idx].obs = fallback.obs || "Fallback nacional";
          }
        });
      } catch (fallbackError) {
        console.error("[cotacoes-gado] fallback CEPEA falhou:", fallbackError);
      }
    }

    data.categorias = data.categorias.map((item) => ({
      ...item,
      preco: item.preco === 0 ? null : item.preco,
      unidade: item.unidade || "arroba",
    }));

    cachedCattle = {
      dataAtual: data.dataAtual,
      fontePrincipal: data.fontePrincipal,
      praça: "São Paulo - SP",
      categorias: data.categorias,
    };
    cachedCattleAt = Date.now();
    return res.json(cachedCattle);
  } catch (error) {
    console.error("[cotacoes-gado] erro:", error);
    return res.status(500).json({ error: "Falha ao obter cotações de gado." });
  }
  // Exemplo de retorno:
  // {
  //   "dataAtual": "2025-12-11",
  //   "fontePrincipal": "Boletim Diário SP + CEPEA fallback",
  //   "praça": "São Paulo - SP",
  //   "categorias": [
  //     { "nome": "Boi gordo (castrado)", "unidade": "arroba", "preco": 322.5, "fonte": "Scot/SP", "obs": "À vista" },
  //     { "nome": "Novilha precoce", "unidade": "arroba", "preco": 310.0, "fonte": "CEPEA - Média Brasil", "obs": "Fallback nacional" }
  //   ]
  // }
});

app.get("/api/previsao", async (_req, res) => {
  // Retorna previsão do tempo para Seringueiras (RO) via OpenAI Search
  if (!FORECAST_ENABLED || !FORECAST_URL) {
    return res.status(503).json({
      ok: false,
      error: "PREVISAO_INDISPONIVEL",
      message: "Previsão temporariamente indisponível.",
    });
  }
  if (!openai) {
    logWeatherWarnOnce("previsao-no-key", "[previsao] OPENAI_API_KEY ausente.");
    if (cachedWeather) {
      return res.json({ ...cachedWeather, stale: true });
    }
    return res.status(503).json({
      ok: false,
      error: "PREVISAO_INDISPONIVEL",
      message: "Previsão temporariamente indisponível.",
    });
  }

  if (!WEATHER_API_ENABLED) {
    return res.status(503).json({ error: "Consultas OpenAI para previsão estão desativadas temporariamente." });
  }

  if (Date.now() < weatherCircuitOpenUntil) {
    if (cachedWeather) {
      return res.json({ ...cachedWeather, stale: true });
    }
    return res.status(503).json({
      ok: false,
      error: "PREVISAO_INDISPONIVEL",
      message: "Previsão temporariamente indisponível.",
    });
  }

  if (Date.now() < weatherFailureCooldownUntil) {
    console.warn("[previsao] cooldown ativo; pulando tentativa para evitar limite.");
    if (cachedWeather) {
      return res.json({ ...cachedWeather, stale: true });
    }
    return res
      .status(503)
      .json({ ok: false, error: "PREVISAO_INDISPONIVEL", message: "Previsão temporariamente indisponível." });
  }

  if (cachedWeather && Date.now() - cachedWeatherAt < WEATHER_CACHE_MS) {
    return res.json(cachedWeather);
  }

  if (!canCallWeatherApi()) {
    if (cachedWeather) {
      return res.json({ ...cachedWeather, stale: true });
    }
    return res
      .status(503)
      .json({ ok: false, error: "PREVISAO_INDISPONIVEL", message: "Previsão temporariamente indisponível." });
  }

  recordWeatherApiCall();

  const { localDate, localTime, timezoneLabel } = getLocalDateTimeInfo();

  const prompt = `
Data e hora local da requisição: ${localDate} ${localTime} (UTC${timezoneLabel})
Você é um meteorologista digital. Usando busca web, responda apenas em JSON (sem markdown):
{
  "cidade": "Seringueiras",
  "estado": "Rondônia",
  "dataAtual": "AAAA-MM-DD",
  "horaAtual": "HH:MM",
  "fonte": "string",
  "tempo": {
    "temperatura": 0,
    "sensacao": 0,
    "condicao": "string",
    "umidade": 0,
    "vento_kmh": 0
  },
  "proximas_horas": [
    {
      "hora": "HH:MM",
      "temperatura": 0,
      "condicao": "string"
    }
  ],
  "amanha": {
    "data": "AAAA-MM-DD",
    "temperatura_min": 0,
    "temperatura_max": 0,
    "condicao": "string",
    "umidade_media": 0,
    "vento_medio_kmh": 0
  }
}
Além da previsão atual e das próximas horas, inclua também a previsão completa do dia seguinte (amanhã) para Seringueiras–RO com mínima, máxima, condição predominante, umidade e vento médio.
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 800,
      tools: [{ type: "web_search_preview" }],
    });
    const rawOutput = response.output_text || "";
    const stripCodeBlock = (text) => {
      if (!text) return text;
      return text
        .replace(/```(?:json)?/g, "")
        .replace(/```/g, "")
        .trim();
    };
    const outputText = stripCodeBlock(rawOutput);
    if (!outputText.trim()) {
      logWeatherWarnOnce("previsao-empty", "[previsao] resposta sem texto");
      weatherFailureCooldownUntil = Date.now() + WEATHER_FAILURE_COOLDOWN_MS;
      if (cachedWeather) {
        return res.json({ ...cachedWeather, stale: true });
      }
      return res.status(503).json({
        ok: false,
        error: "PREVISAO_INDISPONIVEL",
        message: "Previsão temporariamente indisponível.",
      });
    }
    let json;
    try {
      json = JSON.parse(outputText);
    } catch (parseError) {
      logWeatherWarnOnce(
        "previsao-parse",
        `[previsao] parse falhou: ${parseError.message}`
      );
      weatherFailureCooldownUntil = Date.now() + WEATHER_FAILURE_COOLDOWN_MS;
      if (cachedWeather) {
        return res.json({ ...cachedWeather, stale: true });
      }
      return res.status(503).json({
        ok: false,
        error: "PREVISAO_INDISPONIVEL",
        message: "Previsão temporariamente indisponível.",
      });
    }
    cachedWeather = json;
    cachedWeatherAt = Date.now();
    resetWeatherFailureState();
    return res.json(json);
  } catch (error) {
    const status = error?.status || error?.response?.status;
    const code = error?.code || error?.error?.code;
    const type = error?.type || error?.error?.type;
    const isRateLimited = status === 429;
    const isBilling =
      code === "billing_not_active" || type === "billing_not_active";
    const isServerError = status >= 500 && status <= 599;
    const isNetworkError = !status && !!error?.code;
    if (isRateLimited || isBilling || isServerError || isNetworkError) {
      const reason = isBilling ? "billing_not_active" : status || error?.code || "unknown";
      logWeatherWarnOnce(
        `previsao-fail-${reason}`,
        `[previsao] falha OpenAI (${reason}); usando stale se disponível.`
      );
      if (isRateLimited || isBilling) {
        weatherCircuitOpenUntil = Date.now() + WEATHER_CIRCUIT_BREAKER_MS;
      } else {
        weatherFailureCooldownUntil = Date.now() + WEATHER_FAILURE_COOLDOWN_MS;
      }
      if (cachedWeather) {
        return res.json({ ...cachedWeather, stale: true });
      }
      return res.status(503).json({
        ok: false,
        error: "PREVISAO_INDISPONIVEL",
        message: "Previsão temporariamente indisponível.",
      });
    }
    logWeatherWarnOnce(
      "previsao-erro",
      `[previsao] erro inesperado: ${error?.message || "erro desconhecido"}`
    );
    weatherFailureCooldownUntil = Date.now() + WEATHER_FAILURE_COOLDOWN_MS;
    if (cachedWeather) {
      return res.json({ ...cachedWeather, stale: true });
    }
    return res.status(503).json({
      ok: false,
      error: "PREVISAO_INDISPONIVEL",
      message: "Previsão temporariamente indisponível.",
    });
  }
  // Exemplo:
  // {
  //   "cidade": "Seringueiras",
  //   "estado": "Rondônia",
  //   "dataAtual": "2025-12-11",
  //   "horaAtual": "14:30",
  //   "fonte": "OpenAI Web Search + INMET",
  //   "tempo": {...},
  //   "proximas_horas": [...],
  //   "amanha": {...}
  // }
});

const FALLBACK_PLACARES = () => ({
  dataAtual: new Date().toISOString().slice(0, 10),
  fonte: "fallback",
  ao_vivo: [],
  jogos_do_dia: [],
  obs: "Dados indisponíveis, exibindo fallback seguro.",
});

const sanitizeGame = (game = {}, live = false) => {
  const sanitized = {
    campeonato: game.campeonato || "Competição",
    time_casa: game.time_casa || "Casa",
    time_fora: game.time_fora || "Visitante",
    status: game.status || (live ? "Em andamento" : "Programado"),
    placar:
      game.placar && game.placar !== "0" && game.placar !== "0-0" ? game.placar : "–",
    data: game.data || null,
  };
  if (live) {
    sanitized.minuto = game.minuto || "";
  } else {
    sanitized.horario = game.horario || "--:--";
  }
  return sanitized;
};

const sanitizeArray = (list, live = false) => {
  const arr = Array.isArray(list) ? list : [];
  return arr
    .map((game) => sanitizeGame(game, live))
    .filter((game) => game.campeonato || game.time_casa || game.time_fora);
};

app.get("/api/placares", extrasLimiter, async (_req, res) => {
  const { localDate: hoje, localTime, timezoneLabel } = getLocalDateTimeInfo();
  if (!openai) {
    return res.status(400).json({ error: "OPENAI_API_KEY not set" });
  }

  if (cachedScores && Date.now() - cachedScoresAt < CACHE_SCORES_MS) {
    return res.json(cachedScores);
  }

  const prompt = `
Você é um narrador esportivo especializado em campeonatos brasileiros e europeus.
A data de hoje é: ${hoje} (horário local ${localTime}, UTC${timezoneLabel}).
Liste SOMENTE jogos que acontecem HOJE (${hoje}), sem incluir partidas históricas ou futuras.
Inclua:
- Jogos AO VIVO do dia ${hoje}
- Jogos programados para hoje (data ${hoje})
- Placar atualizado para partidas em andamento
- Status (Em andamento / Programado / Encerrado)

Use busca web e responda apenas em JSON:
{
  "dataAtual": "${hoje}",
  "fonte": "string",
  "ao_vivo": [
    {
      "campeonato": "string",
      "time_casa": "string",
      "time_fora": "string",
      "placar": "string",
      "minuto": "string",
      "status": "Em andamento",
      "data": "${hoje}"
    }
  ],
  "jogos_do_dia": [
    {
      "campeonato": "string",
      "horario": "HH:MM",
      "time_casa": "string",
      "time_fora": "string",
      "status": "Programado",
      "placar": null,
      "data": "${hoje}"
    }
  ]
}

Não retornar jogos de datas diferentes de ${hoje}.
`;

  try {
    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: prompt,
      max_output_tokens: 800,
      tools: [{ type: "web_search_preview" }],
    });
    const pool =
      response.output_text ||
      (Array.isArray(response.output)
        ? response.output
            .flatMap((block) => block?.content || [])
            .map((item) => item.text || "")
            .join(" ")
        : "");
    const outputText = cleanOpenAIOutput(pool);
    if (!outputText.trim()) {
      console.error("[placares] resposta sem texto");
      return res.json(FALLBACK_PLACARES());
    }
    let json;
    try {
      json = JSON.parse(outputText);
    } catch (parseError) {
      console.error("[placares] parse falhou:", parseError.message, outputText);
      return res.json(FALLBACK_PLACARES());
    }

    const rawAoVivo = Array.isArray(json.ao_vivo) ? json.ao_vivo : [];
    const rawJogosDoDia = Array.isArray(json.jogos_do_dia) ? json.jogos_do_dia : [];
    const filtroPorDia = (lista) =>
      lista.filter((jogo) => !jogo?.data || jogo.data === hoje);

    json.ao_vivo = sanitizeArray(filtroPorDia(rawAoVivo), true);
    json.jogos_do_dia = sanitizeArray(filtroPorDia(rawJogosDoDia), false);
    json.dataAtual = hoje;
    json.fonte = json.fonte || "OpenAI Web Search";

    cachedScores = json;
    cachedScoresAt = Date.now();
    return res.json(json);
  } catch (error) {
    console.error("[placares] erro:", error);
    if (cachedScores) {
      return res.json(cachedScores);
    }
    return res.json(FALLBACK_PLACARES());
  }
  // Exemplo:
  // {
  //   "dataAtual": "2025-12-11",
  //   "fonte": "OpenAI Web Search - ESPN / Globo / SofaScore",
  //   "ao_vivo": [...],
  //   "jogos_do_dia": [...]
  // }
});

app.use("/api/extras", extrasLimiter);
app.get("/api/extras/weather", async (_req, res) => {
  const data = await touchCache("weather", refreshWeather);
  return res.json(data || { ok: false, message: "Sem dados climáticos." });
});

app.get("/api/extras/commodities", async (_req, res) => {
  const data = await touchCache("commodities", refreshCommodities);
  return res.json(data || { ok: false, message: "Sem dados de commodities." });
});

app.get("/api/extras/scores", async (_req, res) => {
  const data = await touchCache("scores", refreshScores);
  return res.json(data || { ok: false, message: "Sem dados de placares." });
});

// CRUD mínimo de TVs para Roku (protege com a mesma senha de upload).
app.post("/api/roku/tvs", requireUploadAuth, (req, res) => {
  const payload = normalizeTvPayload(req.body);
  if (!payload.id) return res.status(400).json({ ok: false, message: "ID da TV é obrigatório." });
  if (!payload.nome) return res.status(400).json({ ok: false, message: "Nome da TV é obrigatório." });
  if (!payload.marca) return res.status(400).json({ ok: false, message: "Marca do dispositivo é obrigatória." });

  try {
    const tvs = readTvConfig();
    if (tvs.find((tv) => tv.id === payload.id)) {
      return res.status(400).json({ ok: false, message: "Já existe uma TV com esse ID." });
    }
    tvs.push(payload);
    writeTvConfig(tvs);
    return res.json({ ok: true, tv: payload, tvs });
  } catch (error) {
    console.error("Erro ao criar TV:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao salvar TV." });
  }
});

app.put("/api/roku/tvs/:id", requireUploadAuth, (req, res) => {
  const tvId = req.params.id;
  const tvs = readTvConfig();
  const index = tvs.findIndex((tv) => tv.id === tvId);
  if (index === -1) return res.status(404).json({ ok: false, message: "TV não encontrada." });

  const existing = tvs[index];
  const payload = normalizeTvPayload({ ...existing, ...req.body, id: existing.id }, true);
  if (!payload.nome) return res.status(400).json({ ok: false, message: "Nome da TV é obrigatório." });
  if (!payload.marca) return res.status(400).json({ ok: false, message: "Marca do dispositivo é obrigatória." });

  tvs[index] = payload;
  try {
    writeTvConfig(tvs);
    return res.json({ ok: true, tv: payload, tvs });
  } catch (error) {
    console.error("Erro ao atualizar TV:", error.message);
    return res.status(500).json({ ok: false, message: "Erro ao atualizar TV." });
  }
});

app.get("/api/info", (req, res) => {
  const payload = buildMediaManifestPayload(req.query?.target || "todas");
  if (!payload) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }

  const ifNoneMatch = req.headers["if-none-match"];
  res.setHeader("ETag", payload.etag);
  res.setHeader("Last-Modified", payload.lastModified);
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");

  if (ifNoneMatch && ifNoneMatch.includes(payload.etag)) {
    return res.status(304).end();
  }

  return res.json(payload.data);
});

app.get("/api/media/manifest", (req, res) => {
  const payload = buildMediaManifestPayload(req.query?.target || "todas");
  if (!payload) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }

  const ifNoneMatch = req.headers["if-none-match"];
  res.setHeader("ETag", payload.etag);
  res.setHeader("Last-Modified", payload.lastModified);
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");

  if (ifNoneMatch && ifNoneMatch.includes(payload.etag)) {
    return res.status(304).end();
  }

  return res.json(payload.data);
});

app.post("/api/upload", uploadLimiter, requireUploadAuth, upload.single("file"), async (req, res) => {
  if (!req.file) {
    return sendJsonError(res, 400, "FILE_MISSING", "Arquivo ausente no campo 'file'.");
  }

  const ext = (path.extname(req.file.originalname) || "").toLowerCase();
  const isVideo = ext === ".mp4";
  const mode = isVideo ? "video" : "image";
  const target = normalizeTarget(req.body?.target);

  if (isVideo) {
    const rotatedOutput = path.join(rotatedMediaDir, req.file.filename);
    try {
      await rotateMp4Clockwise(req.file.path, rotatedOutput);
    } catch (error) {
      console.error("Erro ao rotacionar vídeo enviado:", error.message);
      return res
        .status(500)
        .json({ ok: false, message: "Erro ao rotacionar vídeo antes da publicação." });
    }
  }

  const item = summarizeFile(req.file.filename, target);
  const items = [item];
  const rotatedRelativePath = isVideo
    ? `/media/${ROTATED_MEDIA_FOLDER}/${req.file.filename}`
    : null;
  let rotatedItem = null;
  if (isVideo) {
    const rotatedFileName = path.join(ROTATED_MEDIA_FOLDER, req.file.filename);
    rotatedItem = summarizeFile(rotatedFileName, target);
  }
  const targetItems =
    target === "acougue" && isVideo && rotatedItem ? [rotatedItem] : items;
  if (target === "acougue" && isVideo) {
    try {
      fs.unlinkSync(req.file.path);
    } catch (error) {
      console.warn("Não foi possível remover vídeo original do acougue:", error.message);
    }
  }
  try {
    const baseConfig = writeMediaConfig(target, mode, targetItems, target === "todas");
    const keepMediaFiles = collectReferencedFilenames(baseConfig.items);
    cleanupKeeping(keepMediaFiles);
  } catch (error) {
    return sendJsonError(
      res,
      500,
      "MEDIA_CONFIG_ERROR",
      "Erro ao salvar configuração da mídia ou atualizar banners da Roku."
    );
  }

  metrics.uploads_total += 1;
  return res.json({
    ok: true,
    mode,
    path: item.path,
    mime: item.mime,
    size: item.size,
    updatedAt: item.updatedAt,
    items: [item],
    rotatedPath: rotatedRelativePath,
  });
});

// Upload de carrossel de imagens (máx. 10).
app.post(
  "/api/upload-carousel",
  uploadLimiter,
  requireUploadAuth,
  uploadCarousel.array("files", MAX_CAROUSEL_ITEMS),
  async (req, res) => {
  const files = req.files || [];
  if (!files.length) {
    return sendJsonError(res, 400, "FILES_MISSING", "Nenhum arquivo enviado (campo 'files').");
  }

  if (files.length > MAX_CAROUSEL_ITEMS) {
    return sendJsonError(
      res,
      400,
      "CAROUSEL_LIMIT",
      `Envie no máximo ${MAX_CAROUSEL_ITEMS} imagens para o carrossel.`
    );
  }

  const target = normalizeTarget(req.body?.target);
  const filenames = files.map((file) => file.filename);
  const items = filenames.map((fileName) => summarizeFile(fileName, target));
  try {
    const nextConfig = writeMediaConfig(target, "carousel", items, target === "todas");
    const keepMediaFiles = collectReferencedFilenames(nextConfig.items);
    cleanupKeeping(keepMediaFiles);
  } catch (error) {
    return sendJsonError(
      res,
      500,
      "CAROUSEL_CONFIG_ERROR",
      "Erro ao salvar configuração do carrossel ou atualizar banners da Roku."
    );
  }

  metrics.uploads_total += 1;
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

app.get("/media/latest", sendLatestMedia);
app.head("/media/latest", sendLatestMedia);

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
    if (!Array.isArray(statsCache)) statsCache = [];
    statsCache.push(event);
    if (statsCache.length > MAX_STATS * 2) {
      statsCache = statsCache.slice(-MAX_STATS);
    }
    scheduleStatsFlush();
    return res.json({ ok: true });
  } catch (error) {
    console.error("Erro ao registrar evento:", error.message);
    return res.status(500).json({ ok: false, message: "Falha ao registrar evento." });
  }
});

app.get("/api/stats/summary", (_req, res) => {
  const events = getStatsSnapshot();
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
  const events = getStatsSnapshot();
  const recent = events.slice(-limit).reverse();
  return res.json({ ok: true, events: recent });
});

app.get("/healthz", (_req, res) => {
  return res.json({ ok: true, uptime: process.uptime(), version: APP_VERSION });
});

app.get("/readyz", (_req, res) => {
  let mediaDirOk = false;
  let mediaConfigOk = true;
  let tvConfigOk = true;
  try {
    mediaDirOk = fs.statSync(mediaDir).isDirectory();
  } catch (_error) {
    mediaDirOk = false;
  }
  if (fs.existsSync(mediaConfigFile)) {
    try {
      fs.readFileSync(mediaConfigFile, "utf8");
    } catch (_error) {
      mediaConfigOk = false;
    }
  }
  if (fs.existsSync(tvConfigFile)) {
    try {
      fs.readFileSync(tvConfigFile, "utf8");
    } catch (_error) {
      tvConfigOk = false;
    }
  }

  const ok = mediaDirOk && mediaConfigOk && tvConfigOk;
  if (!ok) {
    return res.status(503).json({
      ok: false,
      checks: { mediaDir: mediaDirOk, mediaConfig: mediaConfigOk, tvConfig: tvConfigOk },
    });
  }
  return res.json({
    ok: true,
    checks: { mediaDir: mediaDirOk, mediaConfig: mediaConfigOk, tvConfig: tvConfigOk },
  });
});

app.get("/metrics", (_req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const lines = [
    `requests_total ${metrics.requests_total}`,
    `uploads_total ${metrics.uploads_total}`,
    `stream_206_total ${metrics.stream_206_total}`,
    `stream_304_total ${metrics.stream_304_total}`,
    `errors_total ${metrics.errors_total}`,
  ];
  return res.send(`${lines.join("\n")}\n`);
});

app.use((err, _req, res, _next) => {
  if (err) {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return sendJsonError(
          res,
          413,
          "UPLOAD_TOO_LARGE",
          `Arquivo excede o limite de ${MAX_UPLOAD_MB}MB.`
        );
      }
      return sendJsonError(res, 400, "UPLOAD_ERROR", err.message || "Falha no upload.");
    }
    if (err.statusCode && err.errorCode) {
      return sendJsonError(res, err.statusCode, err.errorCode, err.message || "Erro de requisição.");
    }
    if (err.message === "CORS bloqueado") {
      return sendJsonError(res, 403, "CORS_BLOCKED", "Origem não permitida.");
    }
  }
  console.error(err);
  const message = err?.message || "Erro interno";
  return sendJsonError(res, 500, "INTERNAL_ERROR", message);
});

app.listen(PORT, () => {
  scheduleWeatherMediaRefresh();
  console.log(`Servidor rodando em http://localhost:${PORT}`);
});
