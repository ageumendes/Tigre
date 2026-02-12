const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const viewerArea = document.getElementById("viewer-area");
const viewerMedia = document.getElementById("viewer-media");
const storyProgress = document.getElementById("story-progress");
const viewerStatus = document.getElementById("viewer-status");
const downloadButton = document.getElementById("download-button");
const shareButton = document.getElementById("share-button");
const prevNav = document.querySelector(".story-nav.prev");
const nextNav = document.querySelector(".story-nav.next");
const STORY_DURATION = 6000;

let mediaItems = [];
let mediaMode = "image";
let storyIndex = 0;
let storyTimer = null;

const applyRoundedFavicon = () => {
  const link = document.querySelector('link[rel="icon"]');
  if (!link || !link.href) return;
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.onload = () => {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(img, 0, 0, size, size);
    link.href = canvas.toDataURL("image/png");
  };
  img.src = link.href;
};

const setStatus = (message, isError = false) => {
  if (!viewerStatus) return;
  viewerStatus.textContent = message;
  viewerStatus.classList.toggle("error", isError);
  if (message === "Pronto") {
    viewerStatus.style.visibility = "hidden";
    viewerStatus.style.height = "0";
    viewerStatus.style.margin = "0";
  } else {
    viewerStatus.style.visibility = "visible";
    viewerStatus.style.height = "";
    viewerStatus.style.margin = "12px 0 0";
  }
};

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const resolveMediaUrl = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return buildUrl(value);
};
const buildMediaUrl = (item, fallbackUpdatedAt) => {
  if (!item) return "";
  if (item.url) return resolveMediaUrl(item.url);
  if (!item.path) return "";
  const version = item.updatedAt || fallbackUpdatedAt;
  const suffix = version ? `?v=${Math.floor(version)}` : "";
  return `${buildUrl(item.path)}${suffix}`;
};

const clearStoryTimer = () => {
  if (storyTimer) {
    clearTimeout(storyTimer);
    storyTimer = null;
  }
};

const setMultipleState = (hasMultiple) => {
  if (viewerArea) viewerArea.classList.toggle("has-multiple", hasMultiple);
};

const renderProgressBars = (count) => {
  if (!storyProgress) return;
  storyProgress.innerHTML = "";
  const shouldShow = count && count > 1;
  storyProgress.classList.toggle("hidden", !shouldShow);
  if (!shouldShow) return;
  for (let i = 0; i < count; i += 1) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    bar.appendChild(fill);
    storyProgress.appendChild(bar);
  }
};

const updateProgressBars = (count, activeIndex, duration = STORY_DURATION) => {
  if (!storyProgress || !count || count < 1) return;
  const fills = Array.from(storyProgress.querySelectorAll(".bar-fill"));
  fills.forEach((fill, idx) => {
    fill.style.transition = "none";
    if (idx < activeIndex) {
      fill.style.width = "100%";
    } else if (idx === activeIndex) {
      if (duration <= 0) {
        fill.style.width = "100%";
        return;
      }
      fill.style.width = "0%";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fill.style.transition = `width ${duration}ms linear`;
          fill.style.width = "100%";
        });
      });
    } else {
      fill.style.width = "0%";
    }
  });
};

const scheduleAutoAdvance = (count, duration = STORY_DURATION) => {
  clearStoryTimer();
  if (!count || count < 2 || mediaMode === "video") return;
  storyTimer = window.setTimeout(() => showMediaAt(storyIndex + 1), duration);
};

const isVideoItem = (item) =>
  item?.kind === "video" || (item?.mime && item.mime.startsWith("video/")) || mediaMode === "video";

const renderImage = (item) => {
  if (!viewerMedia) return;
  viewerMedia.innerHTML = "";
  const img = document.createElement("img");
  img.src = item.url || item.path;
  img.alt = "Mídia atual";
  viewerMedia.appendChild(img);
};

const renderVideo = (item) => {
  if (!viewerMedia) return;
  viewerMedia.innerHTML = "";
  const video = document.createElement("video");
  video.src = item.url || item.path;
  video.controls = true;
  video.playsInline = true;
  video.autoplay = true;
  video.preload = "auto";
  video.poster = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  viewerMedia.appendChild(video);
};

const updateDownloadLink = (item) => {
  if (!downloadButton || !item) return;
  downloadButton.href = item.url || item.path || "#";
  const filename = (item.path || "").split("/").pop() || "midia";
  downloadButton.download = filename;
};

const getCurrentItem = () => mediaItems[storyIndex] || mediaItems[0];

const downloadCurrentItem = (event) => {
  if (event) event.preventDefault();
  const item = getCurrentItem();
  if (!item) {
    setStatus("Nenhuma mídia para baixar.", true);
    return;
  }
  const url = item.url || item.path;
  if (!url) {
    setStatus("Não foi possível iniciar o download.", true);
    return;
  }
  const filename = (item.path || "").split("/").pop() || "midia";
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setStatus("Baixando mídia atual...");
};

const deriveKind = (item, fallbackMode) => {
  if (item?.kind) return item.kind;
  if (item?.mime && item.mime.startsWith("video/")) return "video";
  if (fallbackMode === "video") return "video";
  return "image";
};

const showMediaAt = (index) => {
  if (!mediaItems.length) return;
  const count = mediaItems.length;
  const safeIndex = ((index % count) + count) % count;
  storyIndex = safeIndex;
  const item = mediaItems[safeIndex];
  const videoItem = isVideoItem(item);
  clearStoryTimer();

  if (videoItem) {
    renderVideo(item);
  } else {
    renderImage(item);
  }

  setMultipleState(count > 1);
  renderProgressBars(count);
  const duration = videoItem ? 0 : STORY_DURATION;
  updateProgressBars(count, storyIndex, duration);
  if (!videoItem) {
    scheduleAutoAdvance(count, duration);
  }
  updateDownloadLink(item);
  setStatus(count > 1 ? "Pronto. Arraste ou use as setas para mudar." : "Pronto");
};

const loadMedia = async () => {
  setStatus("Carregando mídia...");
  clearStoryTimer();

  try {
    const response = await fetch(buildUrl("/api/info"));
    if (response.status === 304 && mediaItems.length) {
      setStatus("Pronto");
      return;
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Nenhuma mídia disponível.");
    const mode = data.mode || (data.mime && data.mime.startsWith("video/") ? "video" : "image");
    const fallbackUpdatedAt = data.updatedAt || data.configUpdatedAt;
    const items = (data.items || []).map((item) => ({
      ...item,
      url: buildMediaUrl(item, fallbackUpdatedAt),
      kind: deriveKind(item, mode),
    }));
    if (!items.length && data.path) {
      items.push({
        path: data.path,
        url: buildMediaUrl(data, fallbackUpdatedAt),
        mime: data.mime,
        size: data.size,
        updatedAt: data.updatedAt,
        kind: deriveKind(data, mode),
      });
    }
    mediaMode = mode;
    mediaItems = items;
    if (!mediaItems.length) {
      setStatus("Nenhuma mídia disponível.", true);
      setMultipleState(false);
      renderProgressBars(0);
      return;
    }
    showMediaAt(0);
    const shareUrl = window.location.origin + window.location.pathname;
    setupShare(shareUrl);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Nenhuma mídia disponível.", true);
  }
};

const copyToClipboard = async (text) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.top = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    return true;
  } catch (err) {
    console.warn("Falhou ao copiar", err);
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
};

const setupShare = (shareUrl) => {
  if (!shareButton) return;
  shareButton.onclick = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: "Mídia atual",
          text: "Confira a mídia mais recente",
          url: shareUrl,
        });
        return;
      }
      const copied = await copyToClipboard(shareUrl);
      setStatus(copied ? "Link copiado para a área de transferência." : "Não foi possível copiar o link.", !copied);
    } catch (error) {
      setStatus("Não foi possível compartilhar.", true);
    }
  };
};

const addSwipeNavigation = () => {
  if (!viewerArea) return;
  let startX = null;
  viewerArea.addEventListener("pointerdown", (event) => {
    startX = event.clientX;
  });
  viewerArea.addEventListener("pointerup", (event) => {
    if (startX === null) return;
    const delta = event.clientX - startX;
    startX = null;
    if (Math.abs(delta) > 40) {
      showMediaAt(storyIndex + (delta > 0 ? -1 : 1));
    }
  });
  viewerArea.addEventListener("pointerleave", () => {
    startX = null;
  });
  viewerArea.addEventListener("pointercancel", () => {
    startX = null;
  });
};

const init = () => {
  applyRoundedFavicon();
  addSwipeNavigation();
  if (prevNav) prevNav.addEventListener("click", () => showMediaAt(storyIndex - 1));
  if (nextNav) nextNav.addEventListener("click", () => showMediaAt(storyIndex + 1));
  if (downloadButton) downloadButton.addEventListener("click", downloadCurrentItem);
  loadMedia();
};

window.addEventListener("DOMContentLoaded", init);
