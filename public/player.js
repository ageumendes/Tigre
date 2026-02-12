const stage = document.getElementById("stage");
const rotWrap = document.getElementById("rotWrap");
const carousel3d = document.getElementById("carousel3d");
const ring = document.getElementById("ring");
const faces = ring ? Array.from(ring.querySelectorAll(".face")) : [];
let currentLayer = stage?.querySelector(".layer.current");
let nextLayer = stage?.querySelector(".layer.next");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnRotate = document.getElementById("btn-rotate");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const controls = document.getElementById("controls");

const normalizeTarget = (value) => {
  const base = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!base) return "todas";
  const noAccents = base.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const dashed = noAccents.replace(/\s+/g, "-");
  return dashed.replace(/[^a-z0-9-_]/g, "").replace(/-+/g, "-").replace(/^-+|-+$/g, "") || "todas";
};

const deriveTargetFromLocation = () => {
  const path = window.location.pathname || "";
  const file = path.split("/").pop() || "";
  if (!file || file === "player.html") return "";
  const match = file.match(/^(.+)\.html$/i);
  return match ? match[1] : "";
};
const target = normalizeTarget(window.PLAYER_TARGET || deriveTargetFromLocation() || "todas");
const apiBase = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const FORCE_SINGLE = Boolean(window.PLAYER_FORCE_SINGLE);
const FORCE_MEDIA_ORIENTATION = (window.PLAYER_FORCE_MEDIA_ORIENTATION || "").toLowerCase();
const buildUrl = (path) => `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
const resolveMediaUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return buildUrl(value);
};
const imageDuration = Number(window.IMAGE_DURATION_MS || 10000) || 10000;
const fadeDurationMs = 450;
const loadTimeoutMs = 2000;
const stallWindowMs = 30000;
const stallThreshold = 2;
const defaultVariantHeight = 720;
const bandwidthRefreshMs = 90000;
const lowBandwidthMbps = 1.5;
const highBandwidthMbps = 5;
const controlsAutoHideMs = 60 * 1000;

let playlist = [];
let index = 0;
let timer = null;
let safetyTimer = null;
let orientation = "landscape";
let rotateDeg = 0;
let isAnimating = false;
const videoState = new WeakMap();
let lastManifestEtag = "";
let measuredBandwidthMbps = 0;
let bandwidthTimer = null;
let displayMode = "landscape";
let controlsHideTimer = null;

const clearControlsHideTimer = () => {
  if (!controlsHideTimer) return;
  clearTimeout(controlsHideTimer);
  controlsHideTimer = null;
};

const hideControls = () => {
  controls?.classList.add("is-hidden");
};

const showControls = ({ restartTimer = true } = {}) => {
  controls?.classList.remove("is-hidden");
  if (!restartTimer) return;
  clearControlsHideTimer();
  controlsHideTimer = setTimeout(hideControls, controlsAutoHideMs);
};

const clearTimers = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
};

const clearFace = (face) => {
  if (!face) return;
  const video = face.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  face.innerHTML = "";
};

const clearLayer = (layer) => {
  if (!layer) return;
  const video = layer.querySelector("video");
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
  }
  layer.innerHTML = "";
};

const getOrientation = () => (window.innerWidth >= window.innerHeight ? "landscape" : "portrait");

const getMediaOrientationMode = () => {
  if (FORCE_MEDIA_ORIENTATION === "portrait" || FORCE_MEDIA_ORIENTATION === "landscape") {
    return FORCE_MEDIA_ORIENTATION;
  }
  return displayMode;
};

const updateScreenClass = () => {
  const isLandscape = window.innerWidth >= window.innerHeight;
  document.documentElement.classList.toggle("screen-landscape", isLandscape);
  document.documentElement.classList.toggle("screen-portrait", !isLandscape);
};

const updateSingleModeClass = () => {
  document.documentElement.classList.toggle("single-mode", FORCE_SINGLE);
};

const applyDisplayModeClass = () => {
  document.documentElement.classList.toggle("mode-landscape", displayMode === "landscape");
  document.documentElement.classList.toggle("mode-portrait", displayMode === "portrait");
};

const updateOrientation = () => {
  const next = getOrientation();
  if (next !== orientation) {
    orientation = next;
    updateScreenClass();
    if (orientation === "portrait") {
      displayMode = "portrait";
      applyDisplayModeClass();
      clearTimers();
      renderPortraitLayers();
      return;
    }
    applyDisplayModeClass();
    clearTimers();
    if (displayMode === "portrait") {
      renderPortraitLayers();
    } else {
      renderRingFaces();
    }
    return;
  }
  updateScreenClass();
};

const debounce = (fn, delayMs) => {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delayMs);
  };
};

const pickVariantFromList = (variants = [], orientationMode = "landscape") => {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) return "";
  const filtered = list.filter((entry) =>
    orientationMode === "portrait"
      ? (entry?.path || "").includes("__portrait__")
      : (entry?.path || "").includes("__landscape__") || !(entry?.path || "").includes("__portrait__")
  );
  const sorted = (filtered.length ? filtered : list)
    .slice()
    .sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0]?.path || "";
};

const getItemKind = (item) => {
  const type = (item?.type || item?.kind || "").toString().toLowerCase();
  if (type === "video" || type === "image") return type;
  if (item?.mime && item.mime.startsWith("video/")) return "video";
  if (item?.mime && item.mime.startsWith("image/")) return "image";
  return "image";
};

const pickImageVariant = (variants = [], targetWidth = 0) => {
  const list = Array.isArray(variants) ? variants : [];
  if (!list.length) return "";
  const sorted = list
    .filter((entry) => entry?.path)
    .slice()
    .sort((a, b) => (a.width || 0) - (b.width || 0));
  if (!sorted.length) return "";
  const candidate = sorted.find((entry) => (entry.width || 0) >= targetWidth);
  return (candidate || sorted[sorted.length - 1])?.path || "";
};

const getTargetDisplayWidth = () => {
  const base = stage?.clientWidth || window.innerWidth || 0;
  const pixelRatio = window.devicePixelRatio || 1;
  return Math.round(base * pixelRatio);
};

const resolveImageUrl = (item) => {
  const mode = getMediaOrientationMode();
  const targetWidth = getTargetDisplayWidth();
  const variantsImage = item?.variantsImage;
  if (Array.isArray(variantsImage) && variantsImage.length) {
    const best = pickImageVariant(variantsImage, targetWidth);
    if (best) return resolveMediaUrl(best);
  }
  if (mode === "portrait") {
    const variantPortrait = pickVariantFromList(item.variantsPortrait, "portrait");
    if (variantPortrait) return resolveMediaUrl(variantPortrait);
    return resolveMediaUrl(
      item.urlPortrait || item.posterUrlPortrait || ""
    );
  }
  const variantLandscape =
    pickVariantFromList(item.variantsLandscape, "landscape") ||
    pickVariantFromList(item.variantsPortrait, "landscape");
  if (variantLandscape) return resolveMediaUrl(variantLandscape);
  return resolveMediaUrl(
    item.url ||
      item.posterUrlLandscape ||
      item.posterUrlPortrait ||
      item.posterUrl ||
      item.path ||
      ""
  );
};

const normalizeVideoVariants = (variants = []) =>
  (Array.isArray(variants) ? variants : [])
    .map((variant) => ({
      height: Number(variant?.height || 0),
      bitrate: Number(variant?.bitrate || 0),
      url: resolveMediaUrl(variant?.path || ""),
    }))
    .filter((variant) => variant.url)
    .sort((a, b) => (a.height || 0) - (b.height || 0));

const getConnectionProfile = () => {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const effectiveType = conn?.effectiveType || "";
  const downlink = Number(conn?.downlink || 0);
  return { effectiveType, downlink };
};

const getBandwidthMbps = () => {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  const downlink = Number(conn?.downlink || 0);
  return downlink || measuredBandwidthMbps || 0;
};

const getTargetVideoHeight = () => {
  const pixelRatio = window.devicePixelRatio || 1;
  const base = stage?.clientHeight || window.innerHeight || 0;
  return Math.max(240, Math.round(base * pixelRatio));
};

const pickInitialVariantIndex = (variants) => {
  if (!variants.length) return -1;
  const { effectiveType } = getConnectionProfile();
  const targetHeight = getTargetVideoHeight();
  const bandwidthMbps = getBandwidthMbps();
  let desired = Math.min(targetHeight, defaultVariantHeight);
  if ((effectiveType && ["2g", "3g"].includes(effectiveType)) || bandwidthMbps < lowBandwidthMbps) {
    desired = 360;
  } else if (bandwidthMbps >= highBandwidthMbps && targetHeight >= 900) {
    desired = 1080;
  }
  const candidate = variants.find((variant) => (variant.height || 0) >= desired);
  if (candidate) return variants.indexOf(candidate);
  return variants.length - 1;
};

const resolveVideoSources = (item) => {
  const mode = getMediaOrientationMode();
  const mp4Fallback =
    mode === "portrait"
      ? item.mp4UrlPortrait || item.urlPortrait || ""
      : item.mp4UrlLandscape || item.mp4UrlPortrait || item.mp4Url || item.urlLandscape || item.url;
  const poster =
    mode === "portrait"
      ? item.posterUrlPortrait || ""
      : item.posterUrlLandscape || item.posterUrlPortrait || item.posterUrl;
  const variantsRaw =
    mode === "portrait" ? item.variantsVideoPortrait : item.variantsVideoLandscape;
  const variants = normalizeVideoVariants(variantsRaw);
  return {
    mp4: resolveMediaUrl(mp4Fallback || ""),
    poster: resolveMediaUrl(poster || ""),
    variants,
  };
};

const isItemPlayableInCurrentMode = (item) => {
  if (!item) return false;
  const kind = getItemKind(item);
  if (kind === "image") return Boolean(resolveImageUrl(item));
  const { mp4, variants } = resolveVideoSources(item);
  return Boolean((Array.isArray(variants) && variants.length) || mp4);
};

const itemMatchesTarget = (item, currentTarget) => {
  const normalized = normalizeTarget(currentTarget);
  const allowed = normalized === "todas" ? new Set(["todas"]) : new Set(["todas", normalized]);
  const rawTargets = Array.isArray(item?.targets)
    ? item.targets
    : item?.target
    ? [item.target]
    : [];
  const normalizedTargets = rawTargets
    .map((entry) => normalizeTarget(entry || ""))
    .filter(Boolean);
  return normalizedTargets.some((entry) => allowed.has(entry));
};

const loadCatalog = async () => {
  const includeGlobal = target !== "todas";
  const query = includeGlobal ? "&includeGlobal=1" : "";
  const response = await fetchManifest(query);
  if (!response) return [];
  const data = response.data;
  if (!data) return [];
  const targetKey = normalizeTarget(target);
  let items = [];
  if (data.targets && data.targets[targetKey]?.items) {
    items = data.targets[targetKey].items;
  } else if (Array.isArray(data.items)) {
    items = data.items;
  }
  return (items || []).filter((item) => itemMatchesTarget(item, targetKey));
};

const fetchManifest = async (query = "") => {
  const headers = {};
  if (lastManifestEtag) headers["If-None-Match"] = lastManifestEtag;
  const response = await fetch(
    buildUrl(`/api/media/manifest?target=${encodeURIComponent(target)}${query}`),
    { headers }
  );
  if (response.status === 304) return null;
  if (!response.ok) return null;
  const etag = response.headers.get("ETag") || "";
  if (etag) lastManifestEtag = etag;
  const data = await response.json().catch(() => null);
  if (!data) return null;
  return { data };
};

const updatePlaylistFromManifest = (items = []) => {
  if (!Array.isArray(items) || !items.length) return;
  const currentItem = playlist[index] || null;
  const currentId = currentItem?.id || null;
  playlist = items;
  if (currentId) {
    const nextIndex = playlist.findIndex((item) => item?.id === currentId);
    if (nextIndex >= 0) {
      index = nextIndex;
      return;
    }
  }
  index = Math.min(index, playlist.length - 1);
};

const measureBandwidth = async () => {
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (conn?.downlink) {
    measuredBandwidthMbps = Number(conn.downlink) || measuredBandwidthMbps;
    return measuredBandwidthMbps;
  }
  const start = performance.now();
  try {
    const response = await fetch(buildUrl(`/api/ping.bin?t=${Date.now()}`), {
      cache: "no-store",
    });
    if (!response.ok) return measuredBandwidthMbps;
    const buffer = await response.arrayBuffer();
    const durationSeconds = (performance.now() - start) / 1000;
    if (durationSeconds > 0 && buffer.byteLength) {
      measuredBandwidthMbps = (buffer.byteLength * 8) / (durationSeconds * 1_000_000);
    }
  } catch (_error) {}
  return measuredBandwidthMbps;
};

const startBandwidthMonitor = () => {
  if (bandwidthTimer) clearInterval(bandwidthTimer);
  measureBandwidth();
  bandwidthTimer = setInterval(measureBandwidth, bandwidthRefreshMs);
};

const refreshManifest = async () => {
  const includeGlobal = target !== "todas";
  const query = includeGlobal ? "&includeGlobal=1" : "";
  const response = await fetchManifest(query);
  if (!response) return;
  const data = response.data;
  if (!data) return;
  const targetKey = normalizeTarget(target);
  let items = [];
  if (data.targets && data.targets[targetKey]?.items) {
    items = data.targets[targetKey].items;
  } else if (Array.isArray(data.items)) {
    items = data.items;
  }
  const filtered = (items || []).filter((item) => itemMatchesTarget(item, targetKey));
  if (!playlist.length && filtered.length) {
    playlist = filtered;
    index = 0;
    if (displayMode === "portrait") {
      renderPortraitLayers();
    } else {
      renderRingFaces();
    }
    return;
  }
  updatePlaylistFromManifest(filtered);
};

const preloadItem = (item) => {
  if (!item) return;
  const kind = getItemKind(item);
  if (kind === "image") {
    const img = new Image();
    img.src = resolveImageUrl(item);
    return;
  }
  const { mp4, variants } = resolveVideoSources(item);
  const initialIndex = pickInitialVariantIndex(variants || []);
  const src = initialIndex >= 0 ? variants[initialIndex]?.url : mp4;
  if (!src) return;
  const video = document.createElement("video");
  video.preload = "metadata";
  video.src = src;
};

const scheduleNext = (ms) => {
  clearTimers();
  timer = setTimeout(nextItem, ms);
};

const scheduleSafetyTimeout = (durationSeconds) => {
  const safeSeconds = Math.max(2, Math.ceil(durationSeconds || 0)) + 1;
  safetyTimer = setTimeout(nextItem, safeSeconds * 1000);
};

const waitForMediaReady = (element, kind) =>
  new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = setTimeout(finish, loadTimeoutMs);
    const onReady = () => {
      clearTimeout(timeout);
      finish();
    };
    if (kind === "image") {
      element.addEventListener("load", onReady, { once: true });
      element.addEventListener("error", onReady, { once: true });
    } else {
      element.addEventListener("loadeddata", onReady, { once: true });
      element.addEventListener("canplay", onReady, { once: true });
      element.addEventListener("error", onReady, { once: true });
    }
  });

const buildImageElement = (item) => {
  const img = document.createElement("img");
  img.src = resolveImageUrl(item) || "";
  return img;
};

const getMainVideoSelection = (item) => {
  const { mp4, poster, variants } = resolveVideoSources(item);
  const initialIndex = pickInitialVariantIndex(variants || []);
  const fallbackIndex = variants.length ? variants.length - 1 : 0;
  const indexToUse = initialIndex >= 0 ? initialIndex : fallbackIndex;
  const url = variants[indexToUse]?.url || mp4 || "";
  return { url, poster, variants, index: indexToUse };
};

const getPreviewSource = (item) => {
  const { mp4, poster, variants } = resolveVideoSources(item);
  const previewVariant = variants && variants.length ? variants[0] : null;
  return { url: previewVariant?.url || mp4 || "", poster };
};

const switchVariantSource = (video, state, newIndex) => {
  if (!state || !state.variants?.length) return false;
  if (newIndex < 0 || newIndex >= state.variants.length) return false;
  const nextVariant = state.variants[newIndex];
  if (!nextVariant?.url) return false;
  const resumeTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  const wasPaused = video.paused;
  video.src = nextVariant.url;
  video.load();
  const applyResume = () => {
    if (Number.isFinite(resumeTime) && resumeTime > 0) {
      try {
        video.currentTime = Math.min(resumeTime, video.duration || resumeTime);
      } catch (_error) {}
    }
    if (!wasPaused) {
      video.play().catch(() => {});
    }
  };
  video.addEventListener("loadedmetadata", applyResume, { once: true });
  state.currentIndex = newIndex;
  state.stallEvents = [];
  return true;
};

const handleStallEvent = (video) => {
  const state = videoState.get(video);
  if (!state) return;
  if (!state.variants?.length) {
    nextItem();
    return;
  }
  const now = Date.now();
  state.stallEvents = state.stallEvents.filter((timestamp) => now - timestamp < stallWindowMs);
  state.stallEvents.push(now);
  if (state.stallEvents.length < stallThreshold) return;
  state.stallEvents = [];
  const nextIndex = state.currentIndex - 1;
  const downgraded = switchVariantSource(video, state, nextIndex);
  if (!downgraded) {
    nextItem();
  }
};

const buildVideoElement = (item, { preview = false } = {}) => {
  if (preview) {
    const { url, poster } = getPreviewSource(item);
    if (poster) {
      const img = document.createElement("img");
      img.src = resolveMediaUrl(poster);
      return img;
    }
    const video = document.createElement("video");
    video.controls = false;
    video.autoplay = false;
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = "metadata";
    video.src = url || "";
    video.addEventListener(
      "loadedmetadata",
      () => {
        try {
          video.currentTime = 0;
        } catch (_error) {}
        video.pause();
      },
      { once: true }
    );
    return video;
  }
  const video = document.createElement("video");
  video.controls = false;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  video.preload = "metadata";

  const { url, poster, variants, index: initialIndex } = getMainVideoSelection(item);
  if (poster) video.poster = poster;
  video.src = url || "";
  videoState.set(video, {
    variants: variants || [],
    currentIndex: initialIndex,
    stallEvents: [],
  });

  video.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(video.duration) && video.duration > 0) {
      video.dataset.duration = `${video.duration}`;
    }
  });
  video.addEventListener("stalled", () => handleStallEvent(video));
  video.addEventListener("waiting", () => handleStallEvent(video));
  video.addEventListener("ended", () => nextItem());
  video.addEventListener("error", () => scheduleNext(10000));
  return video;
};

const mountFace = async (face, item, { preview = false, wait = false } = {}) => {
  clearFace(face);
  if (!item || !face) return { kind: null, element: null };
  const kind = getItemKind(item);
  const element =
    kind === "image" ? buildImageElement(item) : buildVideoElement(item, { preview });
  face.appendChild(element);
  if (wait) {
    await waitForMediaReady(element, kind);
  }
  return { kind, element };
};

const mountLayer = async (layer, item, { wait = false } = {}) => {
  clearLayer(layer);
  if (!item || !layer) return { kind: null, element: null };
  const kind = getItemKind(item);
  const element = kind === "image" ? buildImageElement(item) : buildVideoElement(item);
  layer.appendChild(element);
  if (wait) {
    await waitForMediaReady(element, kind);
  }
  return { kind, element };
};

const isPortraitMedia = (item, element) => {
  const width = Number(item?.width || 0);
  const height = Number(item?.height || 0);
  if (width && height) return height > width;
  if (!element) return false;
  if (element.tagName === "IMG") {
    return element.naturalHeight > element.naturalWidth;
  }
  if (element.tagName === "VIDEO") {
    return element.videoHeight > element.videoWidth;
  }
  return false;
};

const setCarouselMode = (portraitMedia) => {
  if (!carousel3d) return;
  const landscapeScreen = window.innerWidth >= window.innerHeight;
  if (portraitMedia && landscapeScreen) {
    carousel3d.classList.add("portrait-carousel");
    carousel3d.classList.remove("no-carousel");
  } else {
    carousel3d.classList.add("no-carousel");
    carousel3d.classList.remove("portrait-carousel");
    if (ring) {
      ring.style.transition = "none";
      ring.style.transform = "rotateY(0deg)";
      void ring.offsetWidth;
      ring.style.transition = "";
    }
  }
};

const waitForCenterReady = (element, kind) =>
  new Promise((resolve) => {
    if (!element) return resolve();
    const done = () => resolve();
    if (kind === "image") {
      element.addEventListener("load", done, { once: true });
      element.addEventListener("error", done, { once: true });
      return;
    }
    element.addEventListener("loadedmetadata", done, { once: true });
    element.addEventListener("error", done, { once: true });
  });

const depthClassForIndex = (index) => {
  if (index === 0) return "depth-front";
  if (index === 1 || index === 7) return "depth-near";
  if (index === 2 || index === 6) return "depth-mid";
  if (index === 3 || index === 5) return "depth-far";
  return "depth-back";
};

const renderRingFaces = async () => {
  clearTimers();
  if (!playlist.length || !faces.length) return;
  const count = playlist.length;

  const centerFace = faces.find((face) => face.dataset.faceIndex === "0") || faces[0];

  if (FORCE_SINGLE) {
    updateSingleModeClass();
    carousel3d?.classList.add("no-carousel");
    carousel3d?.classList.remove("portrait-carousel");
    for (const face of faces) {
      if (face !== centerFace) clearFace(face);
    }
    const { kind, element } = await mountFace(centerFace, playlist[index], {
      preview: false,
      wait: true,
    });
    if (element && element.tagName === "VIDEO") {
      element.play().catch(() => {});
    }
    if (kind === "image") {
      scheduleNext(imageDuration);
    } else {
      const duration = Number(element?.dataset?.duration || 0) || 0;
      if (duration > 0) {
        scheduleSafetyTimeout(duration);
      } else {
        scheduleSafetyTimeout(60);
      }
    }
    preloadItem(playlist[(index + 1) % playlist.length]);
    return;
  }

  const centerMount = centerFace
    ? mountFace(centerFace, playlist[index], { preview: false, wait: false })
    : Promise.resolve({ kind: null, element: null });

  for (const face of faces) {
    const faceIndex = Number(face.dataset.faceIndex || 0);
    if (face === centerFace) continue;
    const itemIndex = (index + faceIndex) % count;
    mountFace(face, playlist[itemIndex], { preview: true, wait: false });
  }

  faces.forEach((face) => {
    const faceIndex = Number(face.dataset.faceIndex || 0);
    face.classList.remove(
      "depth-front",
      "depth-near",
      "depth-mid",
      "depth-far",
      "depth-back"
    );
    face.classList.add(depthClassForIndex(faceIndex));
  });

  const { kind, element } = await centerMount;

  await waitForCenterReady(element, kind);
  const portraitMedia = isPortraitMedia(playlist[index], element);
  setCarouselMode(portraitMedia);

  if (element && element.tagName === "VIDEO") {
    element.play().catch(() => {});
  }

  if (element) {
    await waitForMediaReady(element, kind);
  }

  if (kind === "image") {
    scheduleNext(imageDuration);
  } else if (element && element.tagName === "VIDEO") {
    const duration = Number(element.dataset.duration || 0);
    if (duration > 0) {
      scheduleSafetyTimeout(duration);
    }
  }
};

const renderPortraitLayers = async () => {
  clearTimers();
  if (!playlist.length || !currentLayer || !nextLayer) return;
  const count = playlist.length;
  const safeIndex = ((index % count) + count) % count;
  index = safeIndex;
  let attempts = 0;
  while (attempts < count && !isItemPlayableInCurrentMode(playlist[index])) {
    index = (index + 1) % count;
    attempts += 1;
  }
  if (!isItemPlayableInCurrentMode(playlist[index])) return;

  nextLayer.classList.remove("is-active");
  const { kind, element } = await mountLayer(nextLayer, playlist[index], { wait: true });
  nextLayer.classList.add("is-active");

  setTimeout(() => {
    if (!currentLayer || !nextLayer) return;
    currentLayer.classList.remove("is-active");
    clearLayer(currentLayer);
    currentLayer.classList.remove("current");
    currentLayer.classList.add("next");
    nextLayer.classList.remove("next");
    nextLayer.classList.add("current");
    const tmp = currentLayer;
    currentLayer = nextLayer;
    nextLayer = tmp;
  }, fadeDurationMs);

  if (kind === "image") {
    scheduleNext(imageDuration);
  } else if (element && element.tagName === "VIDEO") {
    const duration = Number(element.dataset.duration || 0);
    if (duration > 0) {
      scheduleSafetyTimeout(duration);
    }
  }
};

const showItemAtLandscape = (nextIndex) => {
  if (!playlist.length) return;
  const count = playlist.length;
  const safeIndex = ((nextIndex % count) + count) % count;
  index = safeIndex;
  renderRingFaces();
  preloadItem(playlist[(index + 1) % count]);
};

const showItemAtPortrait = (nextIndex) => {
  if (!playlist.length) return;
  const count = playlist.length;
  index = ((nextIndex % count) + count) % count;
  renderPortraitLayers();
  preloadItem(playlist[(index + 1) % count]);
};

const resetRing = () => {
  if (!ring) return;
  ring.style.transition = "none";
  ring.style.transform = "rotateY(0deg)";
  void ring.offsetWidth;
  ring.style.transition = "";
};

const animateNext = () => {
  if (!carousel3d?.classList.contains("portrait-carousel")) {
    showItemAtLandscape(index + 1);
    return;
  }
  if (isAnimating || !ring) return;
  isAnimating = true;
  carousel3d.classList.add("is-animating");
  ring.style.transform = "rotateY(-45deg)";
  ring.addEventListener(
    "transitionend",
    () => {
      index = (index + 1) % playlist.length;
      renderRingFaces();
      resetRing();
      carousel3d.classList.remove("is-animating");
      isAnimating = false;
    },
    { once: true }
  );
};

const animatePrev = () => {
  if (!carousel3d?.classList.contains("portrait-carousel")) {
    showItemAtLandscape(index - 1);
    return;
  }
  if (isAnimating || !ring) return;
  isAnimating = true;
  carousel3d.classList.add("is-animating");
  ring.style.transform = "rotateY(45deg)";
  ring.addEventListener(
    "transitionend",
    () => {
      index = (index - 1 + playlist.length) % playlist.length;
      renderRingFaces();
      resetRing();
      carousel3d.classList.remove("is-animating");
      isAnimating = false;
    },
    { once: true }
  );
};

const nextItem = () => {
  if (displayMode === "portrait") {
    showItemAtPortrait(index + 1);
    return;
  }
  animateNext();
};
const prevItem = () => {
  if (displayMode === "portrait") {
    showItemAtPortrait(index - 1);
    return;
  }
  animatePrev();
};

const startManifestPolling = () => {
  setInterval(() => {
    refreshManifest();
  }, 15000);
};

const startManifestSse = () => {
  if (!window.EventSource) return;
  const delays = [2000, 5000, 10000];
  let attempt = 0;
  let source = null;

  const connect = () => {
    source = new EventSource(buildUrl("/api/media/events"));
    source.addEventListener("manifestUpdated", () => {
      refreshManifest();
    });
    source.onerror = () => {
      try {
        source.close();
      } catch (_error) {}
      const delay = delays[Math.min(attempt, delays.length - 1)];
      attempt += 1;
      setTimeout(connect, delay);
    };
    source.onopen = () => {
      attempt = 0;
    };
  };

  connect();
};

const init = async () => {
  orientation = getOrientation();
  updateScreenClass();
  updateSingleModeClass();
  displayMode =
    FORCE_SINGLE || window.innerHeight > window.innerWidth ? "portrait" : "landscape";
  applyDisplayModeClass();
  startBandwidthMonitor();
  startManifestSse();
  startManifestPolling();
  playlist = await loadCatalog();
  if (!playlist.length) return;
  index = 0;
  if (displayMode === "portrait") {
    renderPortraitLayers();
  } else {
    renderRingFaces();
  }
  preloadItem(playlist[(index + 1) % playlist.length]);
  showControls({ restartTimer: true });
};

btnFullscreen?.addEventListener("click", () => {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

btnRotate?.addEventListener("click", () => {
  displayMode = displayMode === "landscape" ? "portrait" : "landscape";
  applyDisplayModeClass();
  clearTimers();
  if (displayMode === "portrait") {
    renderPortraitLayers();
  } else {
    renderRingFaces();
  }
});
btnNext?.addEventListener("click", nextItem);
btnPrev?.addEventListener("click", prevItem);

window.addEventListener("resize", debounce(updateScreenClass, 150));
window.addEventListener("resize", debounce(updateOrientation, 150));
window.addEventListener("keydown", () => showControls({ restartTimer: true }));
window.addEventListener("click", () => showControls({ restartTimer: true }));
window.addEventListener("touchstart", () => showControls({ restartTimer: true }), {
  passive: true,
});
window.addEventListener("orientationchange", () => {
  setTimeout(updateScreenClass, 200);
  setTimeout(updateOrientation, 200);
});
window.addEventListener("DOMContentLoaded", init);
