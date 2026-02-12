try {
  require("dotenv").config();
} catch (_error) {
  console.warn("dotenv não disponível; as variáveis deverão vir de outras fontes.");
}
const { execFile } = require("child_process");
const { randomUUID, createHash } = require("crypto");
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
let ffprobeInstallerPath = null;
try {
  ffprobeInstallerPath = require("@ffprobe-installer/ffprobe").path;
} catch (_error) {
  ffprobeInstallerPath = null;
}
const ffprobePath = process.env.FFPROBE_PATH || ffprobeInstallerPath || "ffprobe";
let ffmpegAvailable = false;
let ffprobeAvailable = false;
let sharp = null;
try {
  sharp = require("sharp");
} catch (_error) {
  console.warn("Sharp não instalado; variantes de imagem ficarão indisponíveis.");
}
const { renderWeatherPortrait } = require("./weatherScreenshot");

const app = express();
app.disable("x-powered-by");
const PORT = process.env.PORT || 3000;
const mediaDir = process.env.MEDIA_DIR
  ? path.resolve(process.env.MEDIA_DIR)
  : path.join(__dirname, "media");
const LEGACY_ROTATED_MEDIA_FOLDER = "retacionado";
const legacyRotatedMediaDir = path.join(mediaDir, LEGACY_ROTATED_MEDIA_FOLDER);
const screenshotDir = path.join(mediaDir, "screenshots");
const normalizedDir = path.join(mediaDir, "normalized");
const imagesDir = path.join(mediaDir, "images");
const imageVariantsDir = path.join(imagesDir, "variants");
const posterDir = path.join(imagesDir, "posters");
const uploadsDir = path.join(mediaDir, "uploads");
const videoVariantsDir = path.join(mediaDir, "videos", "variants");
const hlsDir = path.join(mediaDir, "hls");
const hlsLatestDir = path.join(mediaDir, "latest");
const WEATHER_PORTRAIT_CACHE_MS = 5 * 60 * 1000;
const WEATHER_PORTRAIT_FILENAME = "weather-portrait.jpeg";
const weatherPortraitPath = path.join(screenshotDir, WEATHER_PORTRAIT_FILENAME);
let weatherPortraitPromise = null;
const statsFile = path.join(__dirname, "stats.json");
const promosFile = path.join(__dirname, "promos.json");
const mediaConfigFile = path.join(__dirname, "media-config.json");
const tvConfigFile = path.join(__dirname, "tv-config.json");
const publicDir = path.join(__dirname, "public");
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
const MAX_TRANSCODE_JOBS = Math.max(
  1,
  parseInt(process.env.MAX_TRANSCODE_JOBS || "1", 10) || 1
);
const MAX_CAROUSEL_ITEMS = parseInt(process.env.MAX_CAROUSEL_ITEMS || "20", 10) || 20;
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ENABLE_PORTRAIT_VARIANTS =
  (process.env.ENABLE_PORTRAIT_VARIANTS || "true").toLowerCase() === "true";
const IMAGE_DURATION_MS = parseInt(process.env.IMAGE_DURATION_MS || "8000", 10) || 8000;
const IMAGE_VARIANTS_ALL = (process.env.IMAGE_VARIANTS_ALL || "1920,1280,1080,720")
  .split(",")
  .map((value) => parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const IMAGE_VARIANTS = IMAGE_VARIANTS_ALL;
const IMAGE_VARIANTS_PORTRAIT = IMAGE_VARIANTS_ALL;
const VIDEO_VARIANTS = (process.env.VIDEO_VARIANTS || "360,720,1080")
  .split(",")
  .map((value) => parseInt(value.trim(), 10))
  .filter((value) => Number.isFinite(value));
const VIDEO_PRESET = process.env.VIDEO_PRESET || "veryfast";
const FFMPEG_CRF = parseInt(process.env.FFMPEG_CRF || "20", 10) || 20;
const ENABLE_HLS = (process.env.ENABLE_HLS || "").toLowerCase() === "true";
const HLS_SEGMENT_TIME = 4;
const HLS_GOP = 48;
const HLS_AUDIO_BITRATE = (process.env.HLS_AUDIO_BITRATE || "128k").trim() || "128k";
const HLS_FORCE_FPS = (process.env.HLS_FORCE_FPS || "").trim();
const HLS_BITRATE_MAP_RAW = (process.env.HLS_BITRATE_MAP || "").trim();
const HLS_RENDITIONS = [360, 720, 1080];
const FORCE_REGEN_HLS = (process.env.FORCE_REGEN_HLS || "").toLowerCase() === "true";
const KEEP_ALIVE_TIMEOUT_SECONDS = 30;
const KEEP_ALIVE_TIMEOUT_MS = KEEP_ALIVE_TIMEOUT_SECONDS * 1000;
console.log("[BOOT] HLS ENABLED =", ENABLE_HLS);
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

let manifestVersion = Date.now();
const manifestClients = new Set();
let manifestKeepAliveTimer = null;
const PING_BIN = Buffer.alloc(200 * 1024, 0);

const broadcastManifestUpdate = () => {
  if (!manifestClients.size) return;
  const payload = JSON.stringify({ manifestVersion });
  manifestClients.forEach((res) => {
    try {
      res.write(`event: manifestUpdated\ndata: ${payload}\n\n`);
    } catch (_error) {}
  });
};

const bumpManifestVersion = () => {
  manifestVersion = Date.now();
  broadcastManifestUpdate();
};

const registerManifestClient = (res) => {
  manifestClients.add(res);
  res.on("close", () => {
    manifestClients.delete(res);
    if (!manifestClients.size && manifestKeepAliveTimer) {
      clearInterval(manifestKeepAliveTimer);
      manifestKeepAliveTimer = null;
    }
  });
  if (!manifestKeepAliveTimer) {
    manifestKeepAliveTimer = setInterval(() => {
      if (!manifestClients.size) return;
      manifestClients.forEach((client) => {
        try {
          client.write(`: ping\n\n`);
        } catch (_error) {}
      });
    }, 20000);
  }
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
  ".m3u8": "application/vnd.apple.mpegurl",
  ".ts": "video/MP2T",
  ".m4s": "video/iso.segment",
};

const ensureDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`Falha ao criar diretório ${dir}:`, error.message);
    throw error;
  }
};

const ensureMediaBase = async (mediaBaseDir) => {
  const baseDirs = [
    path.join(mediaBaseDir, "hls"),
    path.join(mediaBaseDir, "latest"),
    path.join(mediaBaseDir, "normalized"),
    path.join(mediaBaseDir, "images"),
    path.join(mediaBaseDir, "videos"),
    path.join(mediaBaseDir, "uploads"),
  ];
  await Promise.all(
    baseDirs.map((dir) => fs.promises.mkdir(dir, { recursive: true }))
  );
};

const ensureHlsDirs = async (mediaBaseDir, target, videoKey) => {
  const safeTarget = normalizeTarget(target);
  const base = path.join(mediaBaseDir, "hls", safeTarget, videoKey);
  const dirs = [
    path.join(base, "landscape", "0"),
    path.join(base, "landscape", "1"),
    path.join(base, "landscape", "2"),
    path.join(base, "portrait", "0"),
    path.join(base, "portrait", "1"),
    path.join(base, "portrait", "2"),
  ];
  await Promise.all(dirs.map((dir) => fs.promises.mkdir(dir, { recursive: true })));
};

ensureDir(mediaDir);
const uploadTmpDir = path.join(uploadsDir, ".tmp");
ensureDir(uploadTmpDir);
ensureDir(screenshotDir);
ensureDir(normalizedDir);
ensureDir(imagesDir);
ensureDir(imageVariantsDir);
ensureDir(posterDir);
ensureDir(videoVariantsDir);
ensureDir(hlsDir);
ensureDir(hlsLatestDir);
ensureDir(publicDir);
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

const catalogFile = path.join(__dirname, "catalog.json");

const collectReferencedFilenames = (entries = []) => {
  const keep = new Set();
  const addFromUrl = (value) => {
    if (!value || typeof value !== "string") return;
    const clean = value.split("?")[0];
    if (!clean.startsWith("/media/")) return;
    const rel = clean.replace(/^\/media\//, "");
    if (rel) keep.add(rel);
  };
  (entries || []).forEach((item) => {
    addFromUrl(item?.path);
    addFromUrl(item?.mp4UrlLandscape);
    addFromUrl(item?.mp4UrlPortrait);
    addFromUrl(item?.posterUrlLandscape);
    addFromUrl(item?.posterUrlPortrait);
    addFromUrl(item?.hlsMasterUrl);
    addFromUrl(item?.hlsMasterUrlLandscape);
    addFromUrl(item?.hlsMasterUrlPortrait);
    (item?.variantsVideoLandscape || []).forEach((variant) => addFromUrl(variant?.path));
    (item?.variantsVideoPortrait || []).forEach((variant) => addFromUrl(variant?.path));
    (item?.variantsLandscape || []).forEach((variant) => addFromUrl(variant?.path));
    (item?.variantsPortrait || []).forEach((variant) => addFromUrl(variant?.path));
  });
  return Array.from(keep);
};
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

const resolveRelativeMediaPath = (absPath) => {
  if (!absPath) return null;
  const rel = path.relative(mediaDir, absPath);
  if (!rel || rel.includes("..")) return null;
  return `/media/${rel.replace(/\\/g, "/")}`;
};

const safeBasename = (value) =>
  (value || "")
    .toString()
    .replace(/[/\\]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .slice(0, 120) || "file";

const buildItemId = (item) => {
  if (item?.id) return item.id;
  const base = item?.path ? path.basename(item.path) : "item";
  const stamp = Math.floor(item?.updatedAt || Date.now());
  return `${slugifyId(base)}-${stamp}`;
};

const buildEtagForStats = (stats) =>
  `W/"${stats.size}-${Math.floor(stats.mtimeMs || 0)}"`;
const buildStrongEtag = (prefix, payload) => {
  const hash = createHash("sha256").update(payload).digest("hex");
  return `"${prefix}:${hash}"`;
};

const getFileMtimeMs = (filePath) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return 0;
    return Math.floor(fs.statSync(filePath).mtimeMs || 0);
  } catch (_error) {
    return 0;
  }
};

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
  const raw = rangeHeader
    .replace("bytes=", "")
    .split(",")[0]
    .trim();
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

const shouldApplyRange = (req, etag, lastModifiedMs) => {
  const ifRange = req.headers["if-range"];
  if (!ifRange) return true;
  if (ifRange.startsWith("\"") || ifRange.startsWith("W/\"")) {
    return ifRange === etag;
  }
  const parsed = Date.parse(ifRange);
  if (Number.isNaN(parsed)) return false;
  return Math.floor(parsed / 1000) >= Math.floor(lastModifiedMs / 1000);
};

const isVersionedName = (value) =>
  /[0-9]{10,}/.test(value) ||
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i.test(value);

const getMediaCacheControl = (req, absPath) => {
  const url = req?.originalUrl || "";
  const hasVersion =
    !!(req && req.query && (req.query.v || req.query.t)) ||
    url.includes("?v=") ||
    url.includes("&v=") ||
    url.includes("?t=") ||
    url.includes("&t=");
  const ext = path.extname(absPath || "").toLowerCase();
  const rel = absPath ? absPath.replace(mediaDir, "").replace(/\\/g, "/") : "";
  const fileName = path.basename(absPath || "");
  const baseName = fileName.toLowerCase();
  const isVariantImage = rel.includes("/images/variants/");
  const isVersionedAsset = isVersionedName(rel) || isVersionedName(fileName);
  const isManifest = ext === ".m3u8";
  const isHlsSegment = ext === ".ts";

  if (isManifest || isHlsSegment) {
    return "no-cache";
  }
  if (baseName.startsWith("latest") || rel.startsWith("/latest/")) {
    return "public, max-age=0, must-revalidate";
  }
  if (isVariantImage && isVersionedAsset) {
    return "public, max-age=31536000, immutable";
  }
  if (hasVersion) {
    return "public, max-age=31536000, immutable";
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

  const streamWithCleanup = (stream) => {
    const cleanup = () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    };
    res.on("close", cleanup);
    stream.on("error", (error) => {
      console.warn("Erro ao streamar arquivo:", error.message);
      cleanup();
      if (!res.headersSent) {
        res.sendStatus(500);
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
    return stream;
  };

  const rangeHeader = req.headers.range;
  const allowRange =
    (mime || "").toLowerCase() === "video/mp4" || shouldApplyRange(req, etag, stats.mtimeMs || 0);
  if (rangeHeader && allowRange) {
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
    return streamWithCleanup(fs.createReadStream(absPath, { start, end }));
  }

  res.setHeader("Content-Length", stats.size);
  if (req.method === "HEAD") return res.end();
  return streamWithCleanup(fs.createReadStream(absPath));
};

const runFfprobe = (filePath) =>
  new Promise((resolve, reject) => {
    if (!ffprobeAvailable) {
      return resolve(null);
    }
    const args = [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ];
    execFile(ffprobePath, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === "ENOENT") {
          console.warn("[ffprobe] binário não encontrado; seguindo sem metadados.");
          return resolve(null);
        }
        const message =
          stderr && stderr.trim()
            ? `ffprobe stderr: ${stderr
                .trim()
                .split("\n")
                .slice(-3)
                .join(" | ")}`
            : error.message;
        return reject(new Error(`Falha ao ler metadados: ${message}`));
      }
      try {
        const parsed = JSON.parse(stdout || "{}");
        resolve(parsed);
      } catch (parseError) {
        reject(new Error(`Falha ao parsear ffprobe: ${parseError.message}`));
      }
    });
  });

const extractVideoMetadata = (probe) => {
  const streams = Array.isArray(probe?.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video") || {};
  const hasAudio = streams.some((stream) => stream.codec_type === "audio");
  const tags = video.tags || {};
  const sideData = Array.isArray(video.side_data_list) ? video.side_data_list : [];
  const rotateTag = parseInt(tags.rotate, 10);
  const rotateSide = sideData.find((entry) => typeof entry.rotation === "number");
  const rotation = Number.isFinite(rotateTag)
    ? rotateTag
    : Number.isFinite(rotateSide?.rotation)
    ? rotateSide.rotation
    : 0;
  const width = parseInt(video.width, 10) || null;
  const height = parseInt(video.height, 10) || null;
  const duration = parseFloat(video.duration || probe?.format?.duration) || null;
  return { rotation, width, height, duration, hasAudio };
};

const normalizeRotation = (rotation) => {
  if (!Number.isFinite(rotation)) return 0;
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized;
};

const transcodeWithRotation = (inputPath, outputPath, rotation) =>
  new Promise((resolve, reject) => {
    const filter =
      rotation === 90
        ? "transpose=1"
        : rotation === 270
        ? "transpose=2"
        : rotation === 180
        ? "transpose=1,transpose=1"
        : null;
    const args = [
      "-i",
      inputPath,
      ...(filter ? ["-vf", filter] : []),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      String(FFMPEG_CRF),
      "-g",
      String(HLS_GOP),
      "-keyint_min",
      String(HLS_GOP),
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-metadata:s:v",
      "rotate=0",
      "-y",
      outputPath,
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
        return reject(new Error(`Falha ao normalizar vídeo: ${message}`));
      }
      resolve();
    });
  });

const getVideoBitrateForHeight = (height) => {
  if (height <= 360) return 700000;
  if (height <= 720) return 2000000;
  return 4500000;
};

const ensureEven = (value) => {
  const rounded = Math.round(value);
  return rounded % 2 === 0 ? rounded : rounded + 1;
};

const parseBitrateToNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const suffix = lower.slice(-1);
  const num = parseFloat(lower);
  if (!Number.isFinite(num)) return null;
  if (suffix === "k") return Math.round(num * 1000);
  if (suffix === "m") return Math.round(num * 1000000);
  return Math.round(num);
};

const parseHlsBitrateMap = (raw) => {
  if (!raw) return null;
  const map = new Map();
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const [heightRaw, bitrateRaw] = entry.split("=");
      const height = parseInt((heightRaw || "").trim(), 10);
      const bitrate = (bitrateRaw || "").trim();
      if (!Number.isFinite(height) || !bitrate) {
        console.warn(`[hls] HLS_BITRATE_MAP inválido: "${entry}"`);
        return;
      }
      map.set(height, bitrate);
    });
  return map.size ? map : null;
};

const HLS_BITRATE_MAP = parseHlsBitrateMap(HLS_BITRATE_MAP_RAW);

const getHlsBitrateForHeight = (height) => {
  if (HLS_BITRATE_MAP && HLS_BITRATE_MAP.has(height)) {
    return HLS_BITRATE_MAP.get(height);
  }
  const fallback = getVideoBitrateForHeight(height);
  return `${Math.round(fallback / 1000)}k`;
};

const estimateWidthFromHeight = (height, orientation) => {
  const ratio = orientation === "portrait" ? 9 / 16 : 16 / 9;
  return ensureEven(height * ratio);
};

const buildHlsRenditions = (_sourceHeight, orientation) => {
  const heights = Array.isArray(HLS_RENDITIONS) && HLS_RENDITIONS.length ? HLS_RENDITIONS : [];
  const seen = new Set();
  const unique = [];
  heights.forEach((height) => {
    const evenHeight = ensureEven(height);
    if (!evenHeight || seen.has(evenHeight)) return;
    seen.add(evenHeight);
    unique.push(evenHeight);
  });
  return unique.map((height) => {
    const bitrate = getHlsBitrateForHeight(height);
    const bandwidth = parseBitrateToNumber(bitrate) || getVideoBitrateForHeight(height);
    return {
      height,
      width: estimateWidthFromHeight(height, orientation),
      bitrate,
      bandwidth,
    };
  });
};

const parseStreamInfAttributes = (line) => {
  const index = line.indexOf(":");
  if (index < 0) return [];
  const body = line.slice(index + 1);
  const parts = [];
  let current = "";
  let inQuotes = false;
  for (const char of body) {
    if (char === "\"") inQuotes = !inQuotes;
    if (char === "," && !inQuotes) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts
    .map((segment) => {
      const eqIndex = segment.indexOf("=");
      if (eqIndex < 0) return null;
      return {
        key: segment.slice(0, eqIndex).trim().toUpperCase(),
        value: segment.slice(eqIndex + 1).trim(),
      };
    })
    .filter(Boolean);
};

const buildStreamInfLine = (line, rendition, forcedFpsValue) => {
  const attrs = parseStreamInfAttributes(line);
  const reservedKeys = new Set(["BANDWIDTH", "RESOLUTION", "FRAME-RATE", "CODECS"]);
  const attrMap = new Map(attrs.map((attr) => [attr.key, attr.value]));
  const remainder = attrs.filter((attr) => !reservedKeys.has(attr.key));
  const bandwidth =
    rendition.bandwidth ||
    parseBitrateToNumber(rendition.bitrate) ||
    parseBitrateToNumber(attrMap.get("BANDWIDTH"));
  const resolution =
    rendition.width && rendition.height
      ? `${rendition.width}x${rendition.height}`
      : attrMap.get("RESOLUTION");
  const baseAttrs = [];
  if (bandwidth) baseAttrs.push(`BANDWIDTH=${bandwidth}`);
  if (resolution) baseAttrs.push(`RESOLUTION=${resolution}`);
  baseAttrs.push('CODECS="avc1.42e01e,mp4a.40.2"');
  if (forcedFpsValue) baseAttrs.push(`FRAME-RATE=${forcedFpsValue}`);
  remainder.forEach((attr) => {
    baseAttrs.push(`${attr.key}=${attr.value}`);
  });
  return `#EXT-X-STREAM-INF:${baseAttrs.join(",")}`;
};

const ensureHlsMasterTags = (masterPath, renditions) => {
  if (!fs.existsSync(masterPath)) return;
  const parsedFps = parseFloat(HLS_FORCE_FPS);
  const forcedFpsValue = Number.isFinite(parsedFps) && parsedFps > 0 ? parsedFps : null;
  const raw = fs.readFileSync(masterPath, "utf8");
  if (!raw) return;
  const lines = raw.split(/\r?\n/);
  const entries = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF")) {
      entries.push({ index: i, uriIndex: i + 1 });
    }
  }
  if (!entries.length) return;
  const updated = [...lines];
  entries.forEach((entry, idx) => {
    const rendition = renditions[idx];
    if (!rendition) return;
    updated[entry.index] = buildStreamInfLine(updated[entry.index], rendition, forcedFpsValue);
  });
  if (entries.length < renditions.length) {
    for (let i = entries.length; i < renditions.length; i += 1) {
      const rendition = renditions[i];
      updated.push(buildStreamInfLine("#EXT-X-STREAM-INF:", rendition, forcedFpsValue));
      updated.push(`${i}/index.m3u8`);
    }
  }
  const merged = updated.join("\n");
  if (merged !== raw) {
    fs.writeFileSync(masterPath, merged);
  }
};

const buildHlsMasterPlaylist = (renditions, variantUris, forcedFpsValue) => {
  const lines = ["#EXTM3U", "#EXT-X-VERSION:3"];
  renditions.forEach((rendition, index) => {
    const attrs = [];
    if (rendition.bandwidth) attrs.push(`BANDWIDTH=${rendition.bandwidth}`);
    if (rendition.width && rendition.height) {
      attrs.push(`RESOLUTION=${rendition.width}x${rendition.height}`);
    }
    attrs.push('CODECS="avc1.42e01e,mp4a.40.2"');
    if (forcedFpsValue) attrs.push(`FRAME-RATE=${forcedFpsValue}`);
    lines.push(`#EXT-X-STREAM-INF:${attrs.join(",")}`);
    lines.push(variantUris[index] || `${index}/index.m3u8`);
  });
  return `${lines.join("\n")}\n`;
};

const updateLatestHlsMaster = (baseRel, renditions) => {
  const parsedFps = parseFloat(HLS_FORCE_FPS);
  const forcedFpsValue = Number.isFinite(parsedFps) && parsedFps > 0 ? parsedFps : null;
  const variantUris = renditions.map((_rendition, index) => `../${baseRel}/${index}/index.m3u8`);
  const playlist = buildHlsMasterPlaylist(renditions, variantUris, forcedFpsValue);
  try {
    fs.writeFileSync(path.join(hlsLatestDir, "master.m3u8"), playlist);
  } catch (error) {
    console.warn("[hls] falha ao atualizar master latest:", error.message);
  }
};

const generateHlsVariants = async ({
  inputPath,
  target,
  mediaId,
  orientation,
  sourceHeight,
  hasAudio,
  updateLatest = true,
}) => {
  if (!ENABLE_HLS || !ffmpegAvailable) return { masterUrl: "" };
  const safeTarget = normalizeTarget(target);
  const baseDir = path.join(hlsDir, safeTarget, mediaId, orientation);
  const masterPath = path.join(baseDir, "master.m3u8");
  ensureDir(baseDir);

  const renditions = buildHlsRenditions(sourceHeight, orientation);
  if (!renditions.length) {
    console.warn(`[hls] nenhuma rendition válida para ${mediaId} (${orientation}).`);
    return { masterUrl: "" };
  }

  const baseRel = path
    .relative(mediaDir, baseDir)
    .replace(/\\/g, "/")
    .replace(/^\//, "");

  if (!FORCE_REGEN_HLS && fs.existsSync(masterPath)) {
    try {
      if (fs.statSync(masterPath).size > 0) {
        ensureHlsMasterTags(masterPath, renditions);
        if (updateLatest) {
          updateLatestHlsMaster(baseRel, renditions);
        }
        return { masterUrl: `/media/${baseRel}/master.m3u8` };
      }
    } catch (_error) {}
  }

  await ensureHlsDirs(mediaDir, safeTarget, mediaId);
  renditions.forEach((_rendition, index) => {
    ensureDir(path.join(baseDir, String(index)));
  });

  const splitLabels = renditions.map((_rendition, index) => `[v${index}]`).join("");
  const filteredLabels = renditions
    .map(
      (rendition, index) =>
        `[v${index}]scale=-2:${rendition.height}[v${index}out]`
    )
    .join(";");
  const filterComplex = `[0:v]split=${renditions.length}${splitLabels};${filteredLabels}`;

  const args = ["-y", "-i", inputPath, "-filter_complex", filterComplex];
  renditions.forEach((_rendition, index) => {
    args.push("-map", `[v${index}out]`);
    if (hasAudio) args.push("-map", "0:a?");
  });
  renditions.forEach((rendition, index) => {
    args.push(
      `-c:v:${index}`,
      "libx264",
      `-crf:v:${index}`,
      String(FFMPEG_CRF),
      `-b:v:${index}`,
      rendition.bitrate,
      `-g:v:${index}`,
      String(HLS_GOP),
      `-keyint_min:v:${index}`,
      String(HLS_GOP),
      `-sc_threshold:v:${index}`,
      "0"
    );
  });
  args.push("-pix_fmt", "yuv420p");
  const parsedFps = parseFloat(HLS_FORCE_FPS);
  if (HLS_FORCE_FPS && Number.isFinite(parsedFps) && parsedFps > 0) {
    args.push("-r", String(parsedFps));
  }
  args.push("-force_key_frames", `expr:gte(t,n_forced*${HLS_SEGMENT_TIME})`);
  if (hasAudio) {
    args.push("-c:a", "aac", "-b:a", HLS_AUDIO_BITRATE);
  } else {
    args.push("-an");
  }

  const varStreamMap = renditions
    .map((_rendition, index) =>
      hasAudio ? `v:${index},a:${index}` : `v:${index}`
    )
    .join(" ");
  args.push(
    "-f",
    "hls",
    "-hls_time",
    String(HLS_SEGMENT_TIME),
    "-hls_playlist_type",
    "vod",
    "-hls_flags",
    "independent_segments",
    "-hls_segment_filename",
    path.join(baseDir, "%v", "segment_%03d.ts"),
    "-master_pl_name",
    "master.m3u8",
    "-var_stream_map",
    varStreamMap,
    path.join(baseDir, "%v", "index.m3u8")
  );

  console.log(`[hls] gerando HLS (${orientation}) para ${mediaId}...`);
  await new Promise((resolve, reject) => {
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
        return reject(new Error(`Falha ao gerar HLS: ${message}`));
      }
      return resolve();
    });
  });

  ensureHlsMasterTags(masterPath, renditions);
  if (updateLatest) {
    updateLatestHlsMaster(baseRel, renditions);
  }

  return { masterUrl: `/media/${baseRel}/master.m3u8` };
};

const transcodeVideoVariant = (inputPath, outputPath, filter, height) =>
  new Promise((resolve, reject) => {
    try {
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return resolve();
      }
    } catch (_error) {}
    const args = [
      "-y",
      "-i",
      inputPath,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      VIDEO_PRESET,
      "-crf",
      String(FFMPEG_CRF),
      "-g",
      String(HLS_GOP),
      "-keyint_min",
      String(HLS_GOP),
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      "-metadata:s:v",
      "rotate=0",
      outputPath,
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
        return reject(new Error(`Falha ao gerar variante de vídeo: ${message}`));
      }
      resolve();
    });
  });

const generateMp4Variants = async (inputPath, baseName, orientation) => {
  if (!ffmpegAvailable) return [];
  const list = [];
  for (const height of VIDEO_VARIANTS) {
    const output = path.join(
      videoVariantsDir,
      `${baseName}__${orientation}__h${height}.mp4`
    );
    const filter =
      orientation === "portrait"
        ? `transpose=1,scale=-2:${height}`
        : `scale=-2:${height}`;
    try {
      await transcodeVideoVariant(inputPath, output, filter, height);
      const rel = resolveRelativeMediaPath(output);
      if (rel) {
        list.push({ height, bitrate: getVideoBitrateForHeight(height), path: rel });
      }
    } catch (error) {
      console.warn(`[video] falha ao gerar variante ${orientation} ${height}p:`, error.message);
    }
  }
  return list;
};

const processImageVariants = async (
  inputPath,
  baseName,
  orientation,
  rotateDegrees,
  sizes
) => {
  if (!sharp) return null;
  const suffix = orientation ? `__${orientation}` : "";
  const normalizedPath = path.join(imagesDir, `${baseName}${suffix}.webp`);
  const baseImage = rotateDegrees ? sharp(inputPath).rotate(rotateDegrees) : sharp(inputPath).rotate();
  const image = baseImage;
  const metadata = await image.metadata();
  await image.webp({ quality: 85 }).toFile(normalizedPath);

  const variants = [];
  const targets = Array.isArray(sizes) && sizes.length ? sizes : IMAGE_VARIANTS;

  for (const width of targets) {
    const output = path.join(
      imageVariantsDir,
      `${baseName}${suffix}__w${width}.webp`
    );
    const variantBase = rotateDegrees ? sharp(inputPath).rotate(rotateDegrees) : sharp(inputPath).rotate();
    const variant = variantBase;
    if (rotateDegrees) {
      await variant.resize({ height: width }).webp({ quality: 80 }).toFile(output);
    } else {
      await variant.resize({ width }).webp({ quality: 80 }).toFile(output);
    }
    variants.push({
      width,
      path: resolveRelativeMediaPath(output),
    });
  }

  return {
    normalizedPath,
    width: metadata.width || null,
    height: metadata.height || null,
    variants,
  };
};

const chooseBestVariant = (variants = []) => {
  if (!variants.length) return null;
  const sorted = [...variants].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0] || null;
};
const chooseBestVariantExisting = (variants = []) => {
  const filtered = (variants || []).filter((variant) => {
    const absPath = resolveMediaPath(variant?.path);
    return absPath && fs.existsSync(absPath);
  });
  return chooseBestVariant(filtered);
};

const buildVideoFallback = (filePath, fileName, reason, mediaIdOverride) => ({
  landscapePath: filePath,
  portraitPath: null,
  width: null,
  height: null,
  duration: null,
  mediaId: mediaIdOverride || `${slugifyId(path.parse(fileName).name)}-${Date.now()}`,
  posterLandscape: "",
  posterPortrait: "",
  variantsVideoLandscape: [],
  variantsVideoPortrait: [],
  normalized: false,
  reason,
});

const processVideoUploadHeavy = async (filePath, fileName, target, mediaId) => {
  if (!ffprobeAvailable || !ffmpegAvailable) {
    console.warn("[video] ffmpeg unavailable, using original");
    return buildVideoFallback(
      filePath,
      fileName,
      !ffprobeAvailable ? "ffprobe_missing" : "ffmpeg_missing",
      mediaId
    );
  }

  let probe;
  try {
    probe = await runFfprobe(filePath);
  } catch (error) {
    const err = new Error("Arquivo de vídeo inválido.");
    err.statusCode = 400;
    err.errorCode = "INVALID_VIDEO";
    throw err;
  }
  if (!probe) {
    return buildVideoFallback(filePath, fileName, "ffprobe_missing", mediaId);
  }
  const meta = extractVideoMetadata(probe);
  const rotation = normalizeRotation(meta.rotation || 0);
  const baseName = path.parse(fileName).name;
  const landscapePath = path.join(normalizedDir, `${baseName}__landscape.mp4`);
  const portraitPath = path.join(normalizedDir, `${baseName}__portrait.mp4`);
  const resolvedMediaId = mediaId || `${slugifyId(baseName)}-${Date.now()}`;

  if (!fs.existsSync(landscapePath)) {
    if ([90, 180, 270].includes(rotation)) {
      await transcodeWithRotation(filePath, landscapePath, rotation);
    } else {
      await transcodeWithRotation(filePath, landscapePath, 0);
    }
  }

  if (ENABLE_PORTRAIT_VARIANTS && !fs.existsSync(portraitPath)) {
    await transcodeWithRotation(landscapePath, portraitPath, 90);
  }

  const landscapeProbe = await runFfprobe(landscapePath);
  const landscapeMeta = extractVideoMetadata(landscapeProbe);
  const width = landscapeMeta.width || meta.width;
  const height = landscapeMeta.height || meta.height;
  const duration = landscapeMeta.duration || meta.duration;

  const posterLandscape = path.join(posterDir, `${resolvedMediaId}_landscape.webp`);
  const posterPortrait = path.join(posterDir, `${resolvedMediaId}_portrait.webp`);

  const capturePoster = (input, output, rotate) =>
    new Promise((resolve, reject) => {
      if (fs.existsSync(output)) return resolve();
      const args = [
        "-y",
        "-ss",
        "1",
        "-i",
        input,
        "-frames:v",
        "1",
        ...(rotate ? ["-vf", `transpose=${rotate === 90 ? 1 : 2}`] : []),
        "-quality",
        "80",
        output,
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
          return reject(new Error(`Falha ao gerar poster: ${message}`));
        }
        resolve();
      });
    });

  try {
    await capturePoster(landscapePath, posterLandscape, 0);
    if (ENABLE_PORTRAIT_VARIANTS && fs.existsSync(portraitPath)) {
      await capturePoster(portraitPath, posterPortrait, 0);
    }
  } catch (error) {
    logWeatherWarnOnce("poster-fail", `[poster] ${error.message || "erro"}`);
  }

  let variantsVideoLandscape = [];
  let variantsVideoPortrait = [];
  if (ffmpegAvailable) {
    variantsVideoLandscape = await generateMp4Variants(landscapePath, resolvedMediaId, "landscape");
    if (ENABLE_PORTRAIT_VARIANTS) {
      variantsVideoPortrait = await generateMp4Variants(landscapePath, resolvedMediaId, "portrait");
    }
  }

  let hlsMasterUrlLandscape = "";
  let hlsMasterUrlPortrait = "";
  if (ENABLE_HLS && ffmpegAvailable) {
    try {
      const landscapeHls = await generateHlsVariants({
        inputPath: landscapePath,
        target,
        mediaId: resolvedMediaId,
        orientation: "landscape",
        sourceHeight: height,
        hasAudio: meta.hasAudio,
        updateLatest: true,
      });
      hlsMasterUrlLandscape = landscapeHls.masterUrl || "";
    } catch (error) {
      console.warn(`[hls] falha ao gerar landscape: ${error.message}`);
    }
    if (ENABLE_PORTRAIT_VARIANTS && portraitPath && fs.existsSync(portraitPath)) {
      try {
        const portraitHls = await generateHlsVariants({
          inputPath: portraitPath,
          target,
          mediaId: resolvedMediaId,
          orientation: "portrait",
          sourceHeight: width,
          hasAudio: meta.hasAudio,
          updateLatest: false,
        });
        hlsMasterUrlPortrait = portraitHls.masterUrl || "";
      } catch (error) {
        console.warn(`[hls] falha ao gerar portrait: ${error.message}`);
      }
    }
  }

  return {
    landscapePath,
    portraitPath: ENABLE_PORTRAIT_VARIANTS ? portraitPath : null,
    width,
    height,
    duration,
    mediaId: resolvedMediaId,
    posterLandscape: resolveRelativeMediaPath(posterLandscape),
    posterPortrait:
      ENABLE_PORTRAIT_VARIANTS && fs.existsSync(posterPortrait)
        ? resolveRelativeMediaPath(posterPortrait)
        : "",
    variantsVideoLandscape,
    variantsVideoPortrait,
    hlsMasterUrlLandscape,
    hlsMasterUrlPortrait,
    normalized: true,
    reason: "",
  };
};

const transcodeQueue = [];
let transcodeRunning = 0;

const runNextTranscode = () => {
  if (transcodeRunning >= MAX_TRANSCODE_JOBS) return;
  const next = transcodeQueue.shift();
  if (!next) return;
  transcodeRunning += 1;
  next
    .task()
    .then(next.resolve)
    .catch(next.reject)
    .finally(() => {
      transcodeRunning -= 1;
      runNextTranscode();
    });
};

const enqueueTranscode = (task) =>
  new Promise((resolve, reject) => {
    transcodeQueue.push({ task, resolve, reject });
    runNextTranscode();
  });

const processImageUpload = async (filePath, fileName) => {
  const baseName = path.parse(fileName).name;
  if (!sharp) {
    const ext = path.extname(fileName) || ".webp";
    const portraitOutput = path.join(imagesDir, `${baseName}__portrait${ext}`);
    if (ENABLE_PORTRAIT_VARIANTS) {
      try {
        fs.copyFileSync(filePath, portraitOutput);
      } catch (_error) {}
    }
    return {
      landscape: { outputPath: filePath, width: null, height: null, variants: [] },
      portrait: ENABLE_PORTRAIT_VARIANTS
        ? {
            outputPath: fs.existsSync(portraitOutput) ? portraitOutput : filePath,
            width: null,
            height: null,
            variants: [],
          }
        : null,
      portraitFallback: ENABLE_PORTRAIT_VARIANTS,
    };
  }
  const landscape = await processImageVariants(
    filePath,
    baseName,
    "landscape",
    0,
    IMAGE_VARIANTS
  );
  let portrait = null;
  let portraitFallback = false;
  if (ENABLE_PORTRAIT_VARIANTS) {
    try {
      portrait = await processImageVariants(
        landscape?.normalizedPath || filePath,
        baseName,
        "portrait",
        90,
        IMAGE_VARIANTS_PORTRAIT
      );
    } catch (error) {
      console.warn("Falha ao gerar portrait com sharp, aplicando fallback:", error.message);
      portraitFallback = true;
    }
    if (portrait?.normalizedPath) {
      try {
        const portraitMeta = await sharp(portrait.normalizedPath).metadata();
        if (portraitMeta.width && portraitMeta.height && portraitMeta.width >= portraitMeta.height) {
          portrait = await processImageVariants(
            landscape?.normalizedPath || filePath,
            baseName,
            "portrait",
            90,
            IMAGE_VARIANTS_PORTRAIT
          );
        }
      } catch (_error) {}
    }
    if (portrait?.variants?.length) {
      const bestPortrait = chooseBestVariantExisting(portrait.variants);
      if (bestPortrait?.path) {
        try {
          const absVariant = resolveMediaPath(bestPortrait.path);
          if (absVariant) {
            const variantMeta = await sharp(absVariant).metadata();
            if (variantMeta.width && variantMeta.height && variantMeta.width >= variantMeta.height) {
              const width = bestPortrait.width || null;
              if (width) {
                await sharp(landscape?.normalizedPath || filePath)
                  .rotate(90)
                  .resize({ width })
                  .webp({ quality: 80 })
                  .toFile(absVariant);
              }
            }
          }
        } catch (_error) {}
      }
    }
    if ((process.env.DEBUG_IMAGE_PROCESS || "").toLowerCase() === "true") {
      try {
        const landMeta = landscape?.normalizedPath
          ? await sharp(landscape.normalizedPath).metadata()
          : null;
        const portMeta = portrait?.normalizedPath
          ? await sharp(portrait.normalizedPath).metadata()
          : null;
        const bestPortrait = chooseBestVariantExisting(portrait?.variants || []);
        const bestPortraitMeta = bestPortrait?.path
          ? await sharp(resolveMediaPath(bestPortrait.path)).metadata()
          : null;
        console.log("[image] landscape normalized:", landscape?.normalizedPath, landMeta);
        console.log("[image] portrait normalized:", portrait?.normalizedPath, portMeta);
        console.log("[image] portrait variant:", bestPortrait?.path, bestPortraitMeta);
      } catch (_error) {}
    }
    if (!portrait) {
      portraitFallback = true;
      portrait = {
        normalizedPath: landscape?.normalizedPath || filePath,
        width: landscape?.width || null,
        height: landscape?.height || null,
        variants: landscape?.variants || [],
      };
    }
    if (!portrait?.variants?.length && landscape?.variants?.length) {
      portraitFallback = true;
      const copied = [];
      landscape.variants.forEach((variant) => {
        const absSource = resolveMediaPath(variant?.path);
        if (!absSource || !fs.existsSync(absSource)) return;
        const name = path.basename(absSource);
        let portraitName = name.includes("__landscape__")
          ? name.replace("__landscape__", "__portrait__")
          : name.replace(/(__w\d+)/, "__portrait__$1");
        if (portraitName === name) {
          portraitName = portraitName.replace(/(\.[^.]+)$/, "__portrait$1");
        }
        const absDest = path.join(imageVariantsDir, portraitName);
        try {
          fs.copyFileSync(absSource, absDest);
          copied.push({ width: variant.width || null, path: resolveRelativeMediaPath(absDest) });
        } catch (_error) {}
      });
      portrait.variants = copied.length ? copied : portrait.variants || [];
    }
    if (portrait?.normalizedPath && landscape?.normalizedPath && portrait.normalizedPath === landscape.normalizedPath) {
      const portraitPath = path.join(imagesDir, `${baseName}__portrait.webp`);
      try {
        fs.copyFileSync(landscape.normalizedPath, portraitPath);
        portrait.normalizedPath = portraitPath;
      } catch (_error) {}
    }
  }
  return {
    landscape: {
      outputPath: landscape?.normalizedPath || filePath,
      width: landscape?.width || null,
      height: landscape?.height || null,
      variants: landscape?.variants || [],
    },
    portrait: portrait
      ? {
          outputPath: portrait?.normalizedPath || filePath,
          width: portrait?.width || null,
          height: portrait?.height || null,
          variants: portrait?.variants || [],
        }
      : null,
    portraitFallback,
  };
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

const readCatalog = () => {
  try {
    if (!fs.existsSync(catalogFile)) return null;
    const raw = fs.readFileSync(catalogFile, "utf8");
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("Falha ao ler catalog.json:", error.message);
    return null;
  }
};

const buildCatalogItem = (item) => {
  if (!item) return null;
  const id = buildItemId(item);
  const mp4Url = item.path || "";
  const hlsMasterUrl =
    item.hlsMasterUrl || item.hlsMasterUrlLandscape || item.hlsMasterUrlPortrait || "";
  const meta = {
    id,
    type: item.mime && item.mime.startsWith("video/") ? "video" : "image",
    target: normalizeTarget(item.target || "todas"),
    mp4Url,
    mp4UrlLandscape: item.mp4UrlLandscape || mp4Url,
    mp4UrlPortrait: item.mp4UrlPortrait || "",
    hlsMasterUrl,
    hlsMasterUrlLandscape: item.hlsMasterUrlLandscape || "",
    hlsMasterUrlPortrait: item.hlsMasterUrlPortrait || "",
    posterUrl: item.posterUrl || item.posterUrlLandscape || "",
    posterUrlLandscape: item.posterUrlLandscape || "",
    posterUrlPortrait: item.posterUrlPortrait || "",
    variantsLandscape: item.variantsLandscape || [],
    variantsPortrait: item.variantsPortrait || [],
    duration: item.duration || null,
    width: item.width || null,
    height: item.height || null,
    updatedAt: item.updatedAt || Date.now(),
    etag: item.etag || `W/"${id}-${item.updatedAt || 0}"`,
  };
  return meta;
};

const generateCatalogFromConfig = () => {
  const config = readMediaConfig();
  const targets = {};
  const allTargets = new Set(["todas"]);
  Object.keys(config.targets || {}).forEach((target) => allTargets.add(target));

  allTargets.forEach((target) => {
    const entry = target === "todas" ? config : config.targets?.[target];
    const items = Array.isArray(entry?.items) ? entry.items : [];
    targets[target] = {
      items: items.map(buildCatalogItem).filter(Boolean),
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    targets,
  };
};

const writeCatalog = () => {
  const catalog = generateCatalogFromConfig();
  try {
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2));
  } catch (error) {
    console.error("Erro ao gravar catalog.json:", error.message);
  }
  bumpManifestVersion();
  return catalog;
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
  destination: (_req, _file, cb) => cb(null, uploadTmpDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const storageCarousel = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadTmpDir),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || "").toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
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

const buildFinalUploadName = (originalName, target, kind) => {
  const ext = (path.extname(originalName) || "").toLowerCase();
  const safeName = safeBasename(path.parse(originalName || "").name);
  const targetSegment = targetSuffix(target);
  const prefix = kind === "video" ? "video" : kind === "carousel" ? "carousel" : "image";
  return `${prefix}${targetSegment}-${safeName}-${randomUUID()}${ext}`;
};

const moveUploadedFile = (tmpPath, finalName) => {
  const finalPath = path.join(mediaDir, finalName);
  try {
    fs.renameSync(tmpPath, finalPath);
  } catch (error) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_unlinkError) {}
    throw error;
  }
  return finalPath;
};

const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { ok: false, error: "RATE_LIMITED", message: "Muitas requisições. Tente mais tarde." },
});

const extrasLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  message: { ok: false, error: "RATE_LIMITED", message: "Muitas requisições. Tente mais tarde." },
});

const rawCorsOrigins = process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || "";
const allowedCorsOrigins = rawCorsOrigins
  .split(/[;,]/)
  .map((origin) => origin.trim())
  .filter(Boolean);
const isProduction = process.env.NODE_ENV === "production";
const isLocalhostOrigin = (origin) =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin || "");
const buildCorsOptions = ({ allowLocalhost }) => ({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (rawCorsOrigins === "*") return callback(null, true);
    if (!allowedCorsOrigins.length) {
      if (isProduction) return callback(new Error("CORS bloqueado"));
      if (allowLocalhost && isLocalhostOrigin(origin)) return callback(null, true);
      return callback(null, true);
    }
    if (allowLocalhost && !isProduction && isLocalhostOrigin(origin)) {
      return callback(null, true);
    }
    if (allowedCorsOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado"));
  },
});
const apiCors = cors(buildCorsOptions({ allowLocalhost: true }));
const restrictedCors = cors(buildCorsOptions({ allowLocalhost: false }));

const trustProxyRaw = (process.env.TRUST_PROXY || "").trim();
const trustProxyValue =
  trustProxyRaw === "" ? "loopback" : trustProxyRaw === "true" ? true : trustProxyRaw;
app.set("trust proxy", trustProxyValue);
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
app.use((req, res, next) => {
  if (req.httpVersionMajor < 2) {
    res.setHeader("Connection", "keep-alive");
    res.setHeader("Keep-Alive", `timeout=${KEEP_ALIVE_TIMEOUT_SECONDS}`);
  }
  const forwardedProto = `${req.headers["x-forwarded-proto"] || ""}`.toLowerCase();
  if (forwardedProto.includes("https")) {
    res.setHeader("Alt-Svc", 'h2=":443"; ma=86400');
  }
  return next();
});
app.use(
  compression({
    threshold: 0,
    level: 6,
    brotli: { enabled: true },
  })
);
app.use(express.json({ limit: "1mb" }));
app.use("/media", cors({ origin: "*", methods: ["GET", "HEAD", "OPTIONS"] }));
app.use("/api", apiCors);
app.get("/media/*", handleMediaRequest);
app.head("/media/*", handleMediaRequest);
const normalizePlayerTarget = (value) => {
  const base = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!base) return "";
  const noAccents = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dashed = noAccents.replace(/\s+/g, "-");
  return dashed.replace(/[^a-z0-9-_]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
};
const getPlayerTargets = () => {
  const targets = new Set(["todas"]);
  try {
    if (fs.existsSync(tvConfigFile)) {
      const raw = fs.readFileSync(tvConfigFile, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          const rawTarget = item?.tipo || item?.nome || "";
          const normalized = normalizePlayerTarget(rawTarget);
          if (normalized) targets.add(normalized);
        });
      }
    }
  } catch (error) {
    console.warn("Erro ao ler tv-config.json para targets do player:", error.message);
  }
  try {
    if (fs.existsSync(mediaConfigFile)) {
      const raw = fs.readFileSync(mediaConfigFile, "utf8");
      const parsed = JSON.parse(raw);
      const keys = parsed?.targets && typeof parsed.targets === "object" ? Object.keys(parsed.targets) : [];
      keys.forEach((key) => {
        const normalized = normalizePlayerTarget(key);
        if (normalized) targets.add(normalized);
      });
    }
  } catch (error) {
    console.warn("Erro ao ler media-config.json para targets do player:", error.message);
  }
  return targets;
};
const playerTemplate = fs.existsSync(path.join(publicDir, "player.html"))
  ? fs.readFileSync(path.join(publicDir, "player.html"), "utf8")
  : "";
const servePlayer = (target) => (req, res) => {
  if (!playerTemplate) return res.sendStatus(404);
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http: https: ws:;"
  );
  const html = playerTemplate
    .replace("__PLAYER_TARGET__", target)
    .replace("__IMAGE_DURATION__", `${IMAGE_DURATION_MS}`);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.send(html);
};
app.get("/:target.html", (req, res, next) => {
  const target = normalizePlayerTarget(req.params.target);
  if (!target) return next();
  const allowed = getPlayerTargets();
  if (!allowed.has(target)) return next();
  return servePlayer(target)(req, res);
});
app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) => {
  return res.status(204).end();
});

const htmlAllowlist = new Map([
  ["/", "index.html"],
  ["/dashboard", "dashboard.html"],
  ["/dashboard.html", "dashboard.html"],
  ["/promotions", "promotions.html"],
  ["/promotions.html", "promotions.html"],
  ["/captive", "captive.html"],
  ["/captive.html", "captive.html"],
  ["/previsao", "previsao.html"],
  ["/previsao.html", "previsao.html"],
  ["/placares", "placares.html"],
  ["/placares.html", "placares.html"],
  ["/cotacoes", "cotacoes.html"],
  ["/cotacoes.html", "cotacoes.html"],
]);

const sendAllowedHtml = (fileName) => (_req, res) => {
  const filePath = path.join(publicDir, fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Not found");
  }
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; style-src-elem 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' http: https: ws:;"
  );
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  return res.sendFile(filePath);
};

htmlAllowlist.forEach((fileName, route) => {
  app.get(route, sendAllowedHtml(fileName));
});

app.get("/config.js", (_req, res) => {
  const filePath = path.join(publicDir, "config.js");
  if (!fs.existsSync(filePath)) return res.status(404).send("Not found");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Type", "application/javascript; charset=utf-8");
  return res.sendFile(filePath);
});

app.use((req, res, next) => {
  if ((req.method === "GET" || req.method === "HEAD") && req.path.endsWith(".html")) {
    if (!htmlAllowlist.has(req.path)) {
      return res.status(404).send("Not found");
    }
  }
  return next();
});

// Segurança: servir apenas assets públicos explícitos; não expor raiz do projeto.
app.use(
  express.static(publicDir, {
    maxAge: 0,
    setHeaders: (res) => {
      if (!isProduction) {
        res.setHeader("Cache-Control", "no-store");
      }
    },
  })
);

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

const initializeMediaBinaries = async () => {
  ffmpegAvailable = await checkBinary("ffmpeg", ffmpegPath);
  ffprobeAvailable = await checkBinary("ffprobe", ffprobePath);
};

let statsCache = readStatsFromDisk();
let statsFlushTimer = null;
let statsFlushRunning = false;

const getStatsSnapshot = () => (Array.isArray(statsCache) ? [...statsCache] : []);
const getTotalPlays = () =>
  getStatsSnapshot().reduce((count, event) => count + (event?.type === "video_started" ? 1 : 0), 0);

const captureCpuSample = () => {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;
  cpus.forEach((cpu) => {
    const times = cpu.times || {};
    const cpuTotal =
      (times.user || 0) +
      (times.nice || 0) +
      (times.sys || 0) +
      (times.irq || 0) +
      (times.idle || 0);
    total += cpuTotal;
    idle += times.idle || 0;
  });
  return { idle, total };
};

let lastCpuSample = captureCpuSample();
const getCpuUsagePercent = () => {
  const current = captureCpuSample();
  const totalDiff = current.total - lastCpuSample.total;
  const idleDiff = current.idle - lastCpuSample.idle;
  lastCpuSample = current;
  if (!totalDiff || totalDiff <= 0) return 0;
  const usage = 100 * (1 - idleDiff / totalDiff);
  return Math.max(0, Math.min(100, Number(usage.toFixed(2))));
};

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
const DEVICE_KEYS = (process.env.DEVICE_KEYS || "")
  .split(";")
  .map((value) => value.trim())
  .filter(Boolean);

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

const requireDeviceKey = (req, res, next) => {
  if (!DEVICE_KEYS.length) return next();
  const provided = req.headers["x-device-key"];
  if (!provided) {
    return sendJsonError(res, 401, "DEVICE_KEY_MISSING", "Chave do dispositivo ausente.");
  }
  if (!DEVICE_KEYS.includes(provided)) {
    return sendJsonError(res, 403, "DEVICE_KEY_INVALID", "Chave do dispositivo inválida.");
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
  const baseUrl = item.url || buildMediaItemUrl(item, updatedAt);
  const enriched = {
    ...item,
    target: normalizeTarget(item.target || fallbackTarget),
    updatedAt,
    url: baseUrl,
  };
  const isImage =
    (enriched?.mime && enriched.mime.startsWith("image/")) ||
    (!enriched?.mp4UrlLandscape &&
      !enriched?.hlsMasterUrlLandscape &&
      (enriched?.posterUrlLandscape || enriched?.variantsLandscape?.length));
  if (!isImage) return enriched;
  const portraitUrl = enriched.urlPortrait || enriched.posterUrlPortrait || "";
  const variantsPortrait =
    Array.isArray(enriched.variantsPortrait) && enriched.variantsPortrait.length
      ? enriched.variantsPortrait
      : enriched.variantsLandscape || [];
  return {
    ...enriched,
    urlPortrait: portraitUrl || enriched.url,
    variantsLandscape: enriched.variantsLandscape || [],
    variantsPortrait,
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
      updatedAt: Math.max(parsed.updatedAt || 0, getFileMtimeMs(mediaConfigFile)),
    };
  } catch (error) {
    console.warn("Erro ao ler media-config.json:", error.message);
    return { targets: {} };
  }
};

const buildMediaManifestPayload = (requestedTarget, includeGlobal = true) => {
  const target = normalizeTarget(requestedTarget);
  const config = readMediaConfig();
  const configUpdatedAt = Math.max(config.updatedAt || 0, getFileMtimeMs(mediaConfigFile));
  const targetEntry = config.targets?.[target] || null;
  const globalEntry = config.targets?.todas || null;
  const shouldIncludeGlobal = target !== "todas" && includeGlobal;
  const targetItems = targetEntry?.items || [];
  const globalItems = globalEntry?.items || [];
  let combined = [];
  if (target === "todas") {
    combined = globalItems;
  } else if (shouldIncludeGlobal) {
    combined = [...targetItems, ...globalItems];
  } else {
    combined = targetItems;
  }
  const unique = [];
  const seen = new Set();
  let entry;
  combined.forEach((item) => {
    const id = item?.id || buildItemId(item);
    if (seen.has(id)) return;
    seen.add(id);
    unique.push(item);
  });

  if (!unique.length) {
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
  } else {
    entry = {
      target,
      mode: targetEntry?.mode || globalEntry?.mode || config.mode || "video",
      items: unique,
      updatedAt:
        Math.max(
          targetEntry?.updatedAt || 0,
          globalEntry?.updatedAt || 0,
          ...unique.map((item) => item?.updatedAt || 0)
        ) || configUpdatedAt,
    };
  }

  const updatedAt =
    entry.updatedAt ||
    entry.items.reduce((max, item) => Math.max(max, item?.updatedAt || 0), 0) ||
    configUpdatedAt;
  const items = entry.items.map((item) => enrichMediaItem(item, updatedAt, target));
  const primary = items[0] || null;
  const manifestPayload = {
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
    manifestVersion,
  };
  const serializedManifest = JSON.stringify(manifestPayload);
  const etag = buildStrongEtag(
    `manifest:${target}:${shouldIncludeGlobal ? "g" : "l"}`,
    serializedManifest
  );
  const lastModified = new Date(
    Math.max(updatedAt || 0, configUpdatedAt || 0, manifestVersion || 0)
  ).toUTCString();

  return {
    etag,
    lastModified,
    data: manifestPayload,
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
  writeCatalog();
  return nextConfig;
};

const updateMediaItemInConfig = (target, itemId, updater) => {
  const normalizedTarget = normalizeTarget(target);
  const config = readMediaConfig();
  const entry = config.targets?.[normalizedTarget];
  if (!entry || !Array.isArray(entry.items)) return null;
  const updatedItems = entry.items.map((item) => {
    if (item?.id !== itemId) return item;
    return updater(item) || item;
  });
  return writeMediaConfig(normalizedTarget, entry.mode || "video", updatedItems);
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
writeCatalog();

const checkBinary = (label, binPath) =>
  new Promise((resolve) => {
    if (binPath && path.isAbsolute(binPath) && fs.existsSync(binPath)) {
      console.log(`[ffmpeg] ${label} ok em: ${binPath}`);
      return resolve(true);
    }
    execFile(binPath, ["-version"], { windowsHide: true }, (error, stdout) => {
      if (error) {
        if (error.code === "ENOENT") {
          console.warn(
            `[ffmpeg] ${label} não encontrado; uploads de vídeo serão aceitos sem normalização.`
          );
          return resolve(false);
        }
        console.warn(`[ffmpeg] ${label} indisponível: ${error.message}`);
        return resolve(false);
      }
      const found = (stdout || "").trim();
      if (found) {
        console.log(`[ffmpeg] ${label} ok em: ${binPath}`);
        return resolve(true);
      }
      console.warn(`[ffmpeg] ${label} não encontrado; uploads de vídeo serão aceitos sem normalização.`);
      return resolve(false);
    });
  });

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
  writeCatalog();
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
  const keepSet = new Set((keepList || []).filter(Boolean));
  const keepDirSet = new Set();
  keepDirSet.add("hls");
  keepDirSet.add("latest");

  // Segurança: nunca tocar arquivos fora do mediaDir.
  const toRel = (absPath) => {
    const rel = path.relative(mediaDir, absPath);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    return rel.replace(/\\/g, "/");
  };


  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      console.warn(`Não foi possível ler ${dir} para limpeza:`, error.message);
      return;
    }
    entries.forEach((entry) => {
      const absPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
        return;
      }
      if (!entry.isFile()) return;
      const rel = toRel(absPath);
      if (!rel) return;
      const relNormalized = rel.replace(/\\/g, "/");
      if (keepSet.has(relNormalized)) return;
      for (const keepDir of keepDirSet) {
        if (relNormalized.startsWith(`${keepDir}/`)) return;
      }
      try {
        fs.unlinkSync(absPath);
      } catch (error) {
        console.warn(`Não foi possível remover ${relNormalized}:`, error.message);
      }
    });
  };

  // Limpeza centralizada e segura dentro de mediaDir.
  walk(mediaDir);
};

const getRandom = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const EXTRAS_CACHE = {
  weather: { updatedAt: 0, data: null },
  commodities: { updatedAt: 0, data: null },
  scores: { updatedAt: 0, data: null },
};
const EXTRAS_STUB_ENABLED = (process.env.ENABLE_EXTRAS_STUB || "").toLowerCase() === "true";

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
app.get("/api/roku/tvs", restrictedCors, (_req, res) => {
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
  if (!EXTRAS_STUB_ENABLED) {
    return res.status(503).json({ ok: false, message: "Indisponível" });
  }
  const data = await touchCache("weather", refreshWeather);
  return res.json(data || { ok: false, message: "Sem dados climáticos." });
});

app.get("/api/extras/commodities", async (_req, res) => {
  if (!EXTRAS_STUB_ENABLED) {
    return res.status(503).json({ ok: false, message: "Indisponível" });
  }
  const data = await touchCache("commodities", refreshCommodities);
  return res.json(data || { ok: false, message: "Sem dados de commodities." });
});

app.get("/api/extras/scores", async (_req, res) => {
  if (!EXTRAS_STUB_ENABLED) {
    return res.status(503).json({ ok: false, message: "Indisponível" });
  }
  const data = await touchCache("scores", refreshScores);
  return res.json(data || { ok: false, message: "Sem dados de placares." });
});

// CRUD mínimo de TVs para Roku (protege com a mesma senha de upload).
app.post("/api/roku/tvs", restrictedCors, requireUploadAuth, (req, res) => {
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

app.put("/api/roku/tvs/:id", restrictedCors, requireUploadAuth, (req, res) => {
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
  const includeGlobal =
    req.query?.includeGlobal != null ? req.query.includeGlobal === "1" : true;
  const payload = buildMediaManifestPayload(req.query?.target || "todas", includeGlobal);
  if (!payload) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }

  const ifNoneMatch = req.headers["if-none-match"];
  const ifModifiedSince = req.headers["if-modified-since"];
  const sinceMs = ifModifiedSince ? Date.parse(ifModifiedSince) : NaN;
  const lastModifiedMs = Date.parse(payload.lastModified);
  res.setHeader("ETag", payload.etag);
  res.setHeader("Last-Modified", payload.lastModified);
  res.setHeader("Cache-Control", "no-cache");

  if (
    (ifNoneMatch && ifNoneMatch.includes(payload.etag)) ||
    (!Number.isNaN(sinceMs) &&
      !Number.isNaN(lastModifiedMs) &&
      Math.floor(sinceMs / 1000) >= Math.floor(lastModifiedMs / 1000))
  ) {
    return res.status(304).end();
  }

  return res.json(payload.data);
});

app.get("/api/media/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.write(`: connected\n\n`);
  registerManifestClient(res);
});

app.get("/api/media/manifest", (req, res) => {
  const includeGlobal =
    req.query?.includeGlobal != null ? req.query.includeGlobal === "1" : true;
  const payload = buildMediaManifestPayload(req.query?.target || "todas", includeGlobal);
  if (!payload) {
    return res.status(404).json({ ok: false, message: "Nenhuma mídia disponível." });
  }

  const ifNoneMatch = req.headers["if-none-match"];
  const ifModifiedSince = req.headers["if-modified-since"];
  const sinceMs = ifModifiedSince ? Date.parse(ifModifiedSince) : NaN;
  const lastModifiedMs = Date.parse(payload.lastModified);
  res.setHeader("ETag", payload.etag);
  res.setHeader("Last-Modified", payload.lastModified);
  res.setHeader("Cache-Control", "no-cache");

  if (
    (ifNoneMatch && ifNoneMatch.includes(payload.etag)) ||
    (!Number.isNaN(sinceMs) &&
      !Number.isNaN(lastModifiedMs) &&
      Math.floor(sinceMs / 1000) >= Math.floor(lastModifiedMs / 1000))
  ) {
    return res.status(304).end();
  }

  return res.json(payload.data);
});

app.get("/api/ping.bin", (_req, res) => {
  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", PING_BIN.length);
  return res.end(PING_BIN);
});

app.get("/api/catalog", (req, res) => {
  const target = normalizeTarget(req.query?.target || "todas");
  const catalog = readCatalog() || writeCatalog();
  const baseItems = catalog?.targets?.[target]?.items || [];
  const globalItems = catalog?.targets?.todas?.items || [];
  const combined = target === "todas" ? baseItems : [...baseItems, ...globalItems];
  const unique = [];
  const seen = new Set();
  combined.forEach((item) => {
    const id = item?.id || buildItemId(item);
    if (seen.has(id)) return;
    seen.add(id);
    unique.push({ ...item, id });
  });
  const etag = `W/"catalog-${target}-${catalog?.generatedAt || "0"}-${unique.length}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=30, stale-while-revalidate=300");
  if (req.headers["if-none-match"]?.includes(etag)) {
    return res.status(304).end();
  }
  return res.json({
    ok: true,
    target,
    generatedAt: catalog?.generatedAt,
    items: unique,
  });
});

app.post(
  "/api/upload",
  restrictedCors,
  uploadLimiter,
  requireUploadAuth,
  upload.single("file"),
  async (req, res) => {
  if (!req.file) {
    return sendJsonError(res, 400, "FILE_MISSING", "Arquivo ausente no campo 'file'.");
  }

  const ext = (path.extname(req.file.originalname) || "").toLowerCase();
  const mime = (req.file.mimetype || "").toLowerCase();
  const isVideo = ext === ".mp4";
  const isImage = isImageExt(ext);
  const mode = isVideo ? "video" : "image";
  const target = normalizeTarget(req.body?.target);

  const tmpPath = req.file.path;
  if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME_TYPES.has(mime)) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_error) {}
    return sendJsonError(res, 415, "INVALID_MIME", "Tipo de arquivo não suportado.");
  }
  if (isVideo && mime !== "video/mp4") {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_error) {}
    return sendJsonError(res, 415, "INVALID_MIME", "Apenas vídeo MP4 é aceito.");
  }
  if (!isVideo && !isImage) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (_error) {}
    return sendJsonError(res, 415, "INVALID_MIME", "Apenas imagens (jpg/png/webp) são aceitas.");
  }

  const finalName = buildFinalUploadName(req.file.originalname, target, mode);
  let finalPath;
  try {
    finalPath = moveUploadedFile(tmpPath, finalName);
  } catch (error) {
    console.error("Erro ao mover upload:", error.message);
    return sendJsonError(res, 500, "UPLOAD_MOVE_ERROR", "Erro ao mover arquivo enviado.");
  }

  let item = null;
  if (isVideo) {
    const mediaId = `${slugifyId(path.parse(finalName).name)}-${Date.now()}`;
    const baseItem = summarizeFile(finalName, target);
    item = {
      ...baseItem,
      id: mediaId,
      urlLandscape: baseItem.path,
      urlPortrait: baseItem.path,
      mp4UrlLandscape: baseItem.path,
      mp4UrlPortrait: "",
      hlsMasterUrlLandscape: "",
      hlsMasterUrlPortrait: "",
      posterUrlLandscape: "",
      posterUrlPortrait: "",
      variantsVideoLandscape: [],
      variantsVideoPortrait: [],
      normalized: false,
      normalizationReason: "",
    };

    if (ffprobeAvailable && ffmpegAvailable) {
      item.status = "processing";
      item.normalizationReason = "processing";
      enqueueTranscode(async () => {
        let videoResult = null;
        try {
          videoResult = await processVideoUploadHeavy(finalPath, finalName, target, mediaId);
        } catch (error) {
          console.error("Erro ao normalizar vídeo enviado:", error.message);
          updateMediaItemInConfig(target, mediaId, (existing) => ({
            ...existing,
            status: "error",
            normalizationReason: "processing_failed",
          }));
          return;
        }

        const landscapeUrl = resolveRelativeMediaPath(videoResult.landscapePath);
        const portraitUrl = videoResult.portraitPath
          ? resolveRelativeMediaPath(videoResult.portraitPath)
          : "";
        if (!landscapeUrl) {
          updateMediaItemInConfig(target, mediaId, (existing) => ({
            ...existing,
            status: "error",
            normalizationReason: "invalid_path",
          }));
          return;
        }
        if (videoResult?.normalized) {
          try {
            fs.unlinkSync(finalPath);
          } catch (_error) {}
        }
        updateMediaItemInConfig(target, mediaId, (existing) => {
          let updatedBase = existing;
          try {
            updatedBase = summarizeFile(landscapeUrl.replace("/media/", ""), target);
          } catch (_error) {}
          return {
            ...updatedBase,
            id: mediaId,
            width: videoResult.width || null,
            height: videoResult.height || null,
            widthLandscape: videoResult.width || null,
            heightLandscape: videoResult.height || null,
            widthPortrait: videoResult.height || null,
            heightPortrait: videoResult.width || null,
            duration: videoResult.duration || null,
            urlLandscape: landscapeUrl,
            urlPortrait: portraitUrl || landscapeUrl,
            mp4UrlLandscape: landscapeUrl,
            mp4UrlPortrait: portraitUrl || "",
            hlsMasterUrl:
              videoResult.hlsMasterUrlLandscape ||
              videoResult.hlsMasterUrlPortrait ||
              "",
            hlsMasterUrlLandscape: videoResult.hlsMasterUrlLandscape || "",
            hlsMasterUrlPortrait: videoResult.hlsMasterUrlPortrait || "",
            posterUrlLandscape: videoResult.posterLandscape || "",
            posterUrlPortrait: videoResult.posterPortrait || "",
            variantsVideoLandscape: videoResult.variantsVideoLandscape || [],
            variantsVideoPortrait: videoResult.variantsVideoPortrait || [],
            normalized: videoResult.normalized !== false,
            normalizationReason: videoResult.reason || "",
            status: undefined,
          };
        });
      }).catch((error) => {
        console.warn("Fila de transcode falhou:", error.message);
      });
    } else {
      item.normalizationReason = !ffprobeAvailable ? "ffprobe_missing" : "ffmpeg_missing";
    }
  } else {
    let imageResult;
    try {
      imageResult = await processImageUpload(finalPath, finalName);
    } catch (error) {
      console.error("Erro ao normalizar imagem:", error.message);
      try {
        fs.unlinkSync(finalPath);
      } catch (_error) {}
      return sendJsonError(res, 500, "IMAGE_PROCESSING_ERROR", "Erro ao processar imagem.");
    } finally {
      if (sharp) {
        try {
          fs.unlinkSync(finalPath);
        } catch (_error) {}
      }
    }
    const bestLandscape = chooseBestVariantExisting(imageResult?.landscape?.variants || []);
    const bestPortrait = chooseBestVariantExisting(imageResult?.portrait?.variants || []);
    const landscapeUrl =
      bestLandscape?.path || resolveRelativeMediaPath(imageResult?.landscape?.outputPath);
    const portraitUrl =
      bestPortrait?.path ||
      resolveRelativeMediaPath(imageResult?.portrait?.outputPath) ||
      landscapeUrl;
    const portraitVariants =
      imageResult?.portrait?.variants?.length
        ? imageResult.portrait.variants
        : imageResult?.landscape?.variants || [];
    if (!landscapeUrl) {
      return sendJsonError(res, 500, "IMAGE_PROCESSING_ERROR", "Caminho de imagem inválido.");
    }
    item = summarizeFile(landscapeUrl.replace("/media/", ""), target);
    item.width = imageResult?.landscape?.width || null;
    item.height = imageResult?.landscape?.height || null;
    item.widthLandscape = imageResult?.landscape?.width || null;
    item.heightLandscape = imageResult?.landscape?.height || null;
    item.widthPortrait = imageResult?.portrait?.width || null;
    item.heightPortrait = imageResult?.portrait?.height || null;
    item.posterUrlLandscape = landscapeUrl;
    item.posterUrlPortrait = portraitUrl || "";
    item.urlPortrait = portraitUrl || landscapeUrl;
    item.variantsLandscape = imageResult?.landscape?.variants || [];
    item.variantsPortrait = portraitVariants;
    if ((process.env.DEBUG_IMAGE_PROCESS || "").toLowerCase() === "true") {
      const samplePortrait = portraitVariants[0]?.path || "";
      const exists = samplePortrait ? !!resolveMediaPath(samplePortrait) && fs.existsSync(resolveMediaPath(samplePortrait)) : false;
      console.log("[image] landscape variants:", (item.variantsLandscape || []).map((v) => v.path));
      console.log("[image] portrait variants:", (item.variantsPortrait || []).map((v) => v.path));
      console.log("[image] portrait sample exists:", exists);
    }
  }

  const items = [item];
  const targetItems = items;
  try {
    const baseConfig = writeMediaConfig(target, mode, targetItems, target === "todas");
    const catalog = readCatalog();
    const catalogItems = catalog
      ? Object.values(catalog.targets || {}).flatMap((entry) => entry.items || [])
      : [];
    const keepMediaFiles = collectReferencedFilenames([
      ...(baseConfig.items || []),
      ...catalogItems,
    ]);
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
  const rotatedPath =
    item.mp4UrlPortrait ||
    item.posterUrlPortrait ||
    item.mp4UrlLandscape ||
    item.posterUrlLandscape ||
    "";
  return res.json({
    ok: true,
    mode,
    path: item.path,
    mime: item.mime,
    size: item.size,
    updatedAt: item.updatedAt,
    items: [item],
    rotatedPath,
    normalized: item.normalized !== false,
    reason: item.normalizationReason || "",
  });
  }
);

// Upload de carrossel de imagens (máx. 10).
app.post(
  "/api/upload-carousel",
  restrictedCors,
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
  const items = [];
  for (const file of files) {
    let finalPath = null;
    try {
      const ext = (path.extname(file.originalname) || "").toLowerCase();
      const mime = (file.mimetype || "").toLowerCase();
      if (!isImageExt(ext) || !ALLOWED_MIME_TYPES.has(mime) || mime === "video/mp4") {
        try {
          fs.unlinkSync(file.path);
        } catch (_error) {}
        throw new Error("Tipo de arquivo não suportado.");
      }
      const finalName = buildFinalUploadName(file.originalname, target, "carousel");
      finalPath = moveUploadedFile(file.path, finalName);
      const imageResult = await processImageUpload(finalPath, finalName);
      const bestLandscape = chooseBestVariantExisting(imageResult?.landscape?.variants || []);
      const bestPortrait = chooseBestVariantExisting(imageResult?.portrait?.variants || []);
      const landscapeUrl =
        bestLandscape?.path || resolveRelativeMediaPath(imageResult?.landscape?.outputPath);
      const portraitUrl =
        bestPortrait?.path ||
        resolveRelativeMediaPath(imageResult?.portrait?.outputPath) ||
        landscapeUrl;
      const portraitVariants =
        imageResult?.portrait?.variants?.length
          ? imageResult.portrait.variants
          : imageResult?.landscape?.variants || [];
      if (!landscapeUrl || !portraitUrl) {
        throw new Error("Caminho de imagem inválido.");
      }
      const item = summarizeFile(landscapeUrl.replace("/media/", ""), target);
      item.width = imageResult?.landscape?.width || null;
      item.height = imageResult?.landscape?.height || null;
      item.posterUrlLandscape = landscapeUrl;
      item.posterUrlPortrait = portraitUrl;
      item.urlPortrait = portraitUrl || landscapeUrl;
      item.variantsLandscape = imageResult?.landscape?.variants || [];
      item.variantsPortrait = portraitVariants;
      if ((process.env.DEBUG_IMAGE_PROCESS || "").toLowerCase() === "true") {
        const samplePortrait = portraitVariants[0]?.path || "";
        const exists = samplePortrait ? !!resolveMediaPath(samplePortrait) && fs.existsSync(resolveMediaPath(samplePortrait)) : false;
        console.log("[carousel] landscape variants:", (item.variantsLandscape || []).map((v) => v.path));
        console.log("[carousel] portrait variants:", (item.variantsPortrait || []).map((v) => v.path));
        console.log("[carousel] portrait sample exists:", exists);
      }
      items.push(item);
    } catch (error) {
      console.error("Erro ao processar imagem do carrossel:", error.message);
      if (finalPath) {
        try {
          fs.unlinkSync(finalPath);
        } catch (_error) {}
      }
      return sendJsonError(res, 500, "IMAGE_PROCESSING_ERROR", "Erro ao processar imagem.");
    } finally {
      if (sharp) {
        try {
          const cleanupPath = finalPath || file.path;
          fs.unlinkSync(cleanupPath);
        } catch (error) {
          console.warn("Não foi possível remover imagem original do carrossel:", error.message);
        }
      }
    }
  }
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
  }
);

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
app.post("/api/stats/event", requireDeviceKey, (req, res) => {
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

app.get("/metrics.prom", (_req, res) => {
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

app.get("/metrics", (_req, res) => {
  const memory = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = Math.max(totalMem - freeMem, 0);
  const tvs = readTvConfig();
  return res.json({
    ok: true,
    cpu: {
      usagePercent: getCpuUsagePercent(),
      cores: (os.cpus() || []).length,
      loadAverage1m: os.loadavg()[0] || 0,
    },
    memory: {
      processRssBytes: memory.rss,
      processHeapUsedBytes: memory.heapUsed,
      systemUsedBytes: usedMem,
      systemTotalBytes: totalMem,
      systemUsagePercent: totalMem ? Number(((usedMem / totalMem) * 100).toFixed(2)) : 0,
    },
    tvsConnected: Array.isArray(tvs) ? tvs.length : 0,
    plays: getTotalPlays(),
  });
});

app.get("/healthz", (_req, res) => {
  return res.json({ ok: true, version: APP_VERSION });
});

app.get("/readyz", (_req, res) => {
  const exists = fs.existsSync(mediaDir);
  let writable = false;
  if (exists) {
    try {
      fs.accessSync(mediaDir, fs.constants.W_OK);
      writable = true;
    } catch (_error) {
      writable = false;
    }
  }
  if (!exists || !writable) {
    return res.status(503).json({ ok: false, reason: "mediaDir_not_writable" });
  }
  return res.json({ ok: true });
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

const setupManifestWatchers = () => {
  const debounceMs = 500;
  let timer = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      bumpManifestVersion();
    }, debounceMs);
  };
  const safeWatch = (target) => {
    try {
      if (!fs.existsSync(target)) return;
      fs.watch(target, { persistent: false }, schedule);
    } catch (error) {
      console.warn(`Falha ao observar ${target}:`, error.message);
    }
  };
  safeWatch(catalogFile);
  safeWatch(mediaConfigFile);
  safeWatch(mediaDir);
};

let server = null;
const startServer = async () => {
  await ensureMediaBase(mediaDir);
  server = app.listen(PORT, () => {
    initializeMediaBinaries().catch((error) => {
      console.warn("[ffmpeg] falha ao checar binários:", error.message);
    });
    scheduleWeatherMediaRefresh();
    setupManifestWatchers();
    console.log(`Servidor rodando em http://localhost:${PORT}`);
  });
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = KEEP_ALIVE_TIMEOUT_MS + 5000;
};

const shutdown = (signal) => {
  console.log(`[shutdown] recebendo ${signal}, encerrando servidor...`);
  if (!server) {
    process.exit(0);
    return;
  }
  server.close(() => {
    Promise.resolve(flushStatsToDisk())
      .catch(() => {})
      .finally(() => process.exit(0));
  });
};
startServer().catch((error) => {
  console.error("[boot] falha ao iniciar servidor:", error.message);
  process.exit(1);
});
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
