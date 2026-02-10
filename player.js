const container = document.getElementById("media-container");
const btnFullscreen = document.getElementById("btn-fullscreen");
const btnRotate = document.getElementById("btn-rotate");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");

const target = window.PLAYER_TARGET || "todas";
const apiBase = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const buildUrl = (path) => `${apiBase}${path.startsWith("/") ? path : `/${path}`}`;
const imageDuration = Number(window.IMAGE_DURATION_MS || 8000);

let playlist = [];
let index = 0;
let timer = null;
let rotEnabled = false;

const clearTimer = () => {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
};

const setRotation = (enabled) => {
  rotEnabled = enabled;
  if (container) {
    container.classList.toggle("rot90", rotEnabled);
  }
};

const loadCatalog = async () => {
  const response = await fetch(buildUrl(`/api/catalog?target=${encodeURIComponent(target)}`));
  if (!response.ok) return [];
  const data = await response.json().catch(() => null);
  return data?.items || [];
};

const ensureHls = async () => {
  if (window.Hls) return window.Hls;
  return null;
};

const renderImage = (item) => {
  container.innerHTML = "";
  const img = document.createElement("img");
  img.src = item.posterUrl || item.mp4Url || item.path || "";
  container.appendChild(img);
  clearTimer();
  timer = setTimeout(nextItem, imageDuration);
};

const renderVideo = async (item) => {
  container.innerHTML = "";
  const video = document.createElement("video");
  video.controls = false;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.loop = false;
  container.appendChild(video);

  const sourceUrl = item.hlsMasterUrl || item.mp4Url;
  if (item.hlsMasterUrl) {
    const Hls = await ensureHls();
    if (Hls && Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: false });
      hls.loadSource(sourceUrl);
      hls.attachMedia(video);
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = sourceUrl;
    } else {
      video.src = item.mp4Url;
    }
  } else {
    video.src = sourceUrl;
  }

  clearTimer();
  video.onended = () => nextItem();
};

const showItem = async (item) => {
  if (!item) return;
  if (item.type === "image") {
    renderImage(item);
    return;
  }
  await renderVideo(item);
};

const nextItem = () => {
  if (!playlist.length) return;
  index = (index + 1) % playlist.length;
  showItem(playlist[index]);
};

const prevItem = () => {
  if (!playlist.length) return;
  index = (index - 1 + playlist.length) % playlist.length;
  showItem(playlist[index]);
};

const init = async () => {
  playlist = await loadCatalog();
  if (!playlist.length) return;
  index = 0;
  showItem(playlist[index]);
};

btnFullscreen?.addEventListener("click", () => {
  const elem = document.documentElement;
  if (!document.fullscreenElement) {
    elem.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

btnRotate?.addEventListener("click", () => setRotation(!rotEnabled));
btnNext?.addEventListener("click", nextItem);
btnPrev?.addEventListener("click", prevItem);

window.addEventListener("DOMContentLoaded", init);
