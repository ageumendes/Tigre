const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const viewerArea = document.getElementById("viewer-area");
const viewerStatus = document.getElementById("viewer-status");
const downloadButton = document.getElementById("download-button");
const shareButton = document.getElementById("share-button");

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

const renderCarousel = (items) => {
  if (!viewerArea) return;
  viewerArea.innerHTML = "";
  if (!items?.length) {
    const empty = document.createElement("div");
    empty.className = "placeholder";
    empty.textContent = "Nenhuma imagem no carrossel.";
    viewerArea.appendChild(empty);
    return;
  }

  let index = 0;
  const main = document.createElement("img");
  main.alt = "Carrossel";
  main.className = "viewer-carousel-main";

  const setImage = (i) => {
    index = (i + items.length) % items.length;
    main.src = items[index].url || items[index].path;
  };
  setImage(0);

  const prev = document.createElement("button");
  prev.className = "ghost-button small";
  prev.textContent = "Anterior";
  prev.addEventListener("click", () => setImage(index - 1));

  const next = document.createElement("button");
  next.className = "ghost-button small";
  next.textContent = "Próximo";
  next.addEventListener("click", () => setImage(index + 1));

  const controls = document.createElement("div");
  controls.className = "viewer-actions";
  controls.appendChild(prev);
  controls.appendChild(next);

  viewerArea.appendChild(main);
  viewerArea.appendChild(controls);
};

const renderMedia = (mode, url, items) => {
  if (!viewerArea) return;
  viewerArea.innerHTML = "";

  if (mode === "carousel") {
    renderCarousel(items);
    return;
  }

  if (mode === "video") {
    const video = document.createElement("video");
    video.src = url;
    video.controls = true;
    video.playsInline = true;
    video.autoplay = true;
    video.preload = "auto";
    video.poster = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    viewerArea.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Mídia atual";
    viewerArea.appendChild(img);
  }
};

const fetchLatest = async () => {
  const response = await fetch(buildUrl(`/api/info?t=${Date.now()}`), { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  const mode = data.mode || (data.mime && data.mime.startsWith("video/") ? "video" : "image");
  const items = (data.items || []).map((item) => ({
    ...item,
    url: item.path ? `${buildUrl(item.path)}?t=${Date.now()}` : "",
  }));
  const primary = items[0] || data;
  const url = primary.path ? `${buildUrl(primary.path)}?t=${Date.now()}` : null;
  return { ...data, mode, items, primary, url };
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
  shareButton.addEventListener("click", async () => {
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
  });
};

const init = async () => {
  setStatus("Carregando mídia...");
  const data = await fetchLatest();

  if (!data?.ok) {
    setStatus(data?.message || "Nenhuma mídia disponível.", true);
    return;
  }

  const mode = data.mode || (data.mime && data.mime.startsWith("video/") ? "video" : "image");
  const mediaUrl = data.url || (data.path ? `${buildUrl(data.path)}?t=${Date.now()}` : "");
  renderMedia(mode, mediaUrl, data.items);
  setStatus("Pronto");

  const downloadName = (data.path || data.primary?.path || "").split("/").pop() || "latest";
  if (downloadButton) {
    downloadButton.href = mediaUrl;
    downloadButton.download = downloadName;
  }

  const shareUrl = window.location.origin + window.location.pathname;
  setupShare(shareUrl);
};

window.addEventListener("DOMContentLoaded", init);
