const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const mediaArea = document.getElementById("media-area");
const statusLabel = document.getElementById("status");
const refreshButton = document.getElementById("refresh-button");
const viewLiveButton = document.getElementById("view-live-button");

const uploadInput = document.getElementById("upload-input");
const chooseUploadButton = document.getElementById("choose-upload-button");
const uploadStatus = document.getElementById("upload-status");
const uploadPreview = document.getElementById("upload-preview");
const viewUploadButton = document.getElementById("view-upload-button");
const publishButton = document.getElementById("publish-button");

const viewerOverlay = document.getElementById("viewer-overlay");
const viewerSlot = document.getElementById("viewer-slot");
const closeViewerButton = document.getElementById("close-viewer");

const ALLOWED_UPLOAD_MIMES = ["video/mp4", "video/webm", "video/ogg", "video/quicktime", "video/x-matroska", "image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
let currentLiveMedia = null;
let currentUpload = null;
let uploadUrl = null;

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

const setStatus = (message, isError = false) => {
  if (!statusLabel) return;
  statusLabel.textContent = message;
  statusLabel.classList.toggle("error", isError);
};

const setUploadMessage = (message, isError = false) => {
  if (!uploadStatus) return;
  uploadStatus.textContent = message;
  uploadStatus.classList.toggle("error", isError);
};

const renderPlaceholder = () => {
  if (!mediaArea) return;
  mediaArea.innerHTML = `
    <div class="placeholder">
      <p>Ao publicar, a página busca o arquivo mais recente no backend configurado.</p>
      <small>Use “Recarregar mídia” para forçar uma atualização sem cache.</small>
    </div>
  `;
};

const renderUploadPlaceholder = () => {
  if (!uploadPreview) return;
  uploadPreview.innerHTML = `
    <div class="placeholder">
      <p>Selecione um arquivo para pré-visualizar aqui.</p>
      <small>Depois clique em “Enviar e publicar” para gravar no backend.</small>
    </div>
  `;
};

const renderMediaInto = (target, candidate) => {
  if (!target || !candidate) return;

  target.innerHTML = "";
  if (candidate.kind === "video") {
    const video = document.createElement("video");
    video.src = candidate.url;
    video.controls = true;
    video.playsInline = true;
    video.preload = "auto";
    video.poster = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
    target.appendChild(video);
  } else {
    const img = document.createElement("img");
    img.src = candidate.url;
    img.alt = "Arquivo atual";
    target.appendChild(img);
  }
};

const fetchLatestInfo = async () => {
  const url = buildUrl(`/api/info?t=${Date.now()}`);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  const kind = data.mime && data.mime.startsWith("video/") ? "video" : "image";
  const mediaUrl = `${buildUrl(data.path)}?t=${Date.now()}`;
  return { url: mediaUrl, kind, path: data.path, mime: data.mime, size: data.size, updatedAt: data.updatedAt };
};

const loadMedia = async () => {
  setStatus("Procurando arquivo...");
  if (viewLiveButton) viewLiveButton.disabled = true;

  try {
    currentLiveMedia = await fetchLatestInfo();
  } catch (error) {
    setStatus("Erro ao contactar o backend. Verifique API_BASE em config.js.", true);
    renderPlaceholder();
    return;
  }

  if (!currentLiveMedia) {
    renderPlaceholder();
    setStatus("Nenhuma mídia publicada ainda.", true);
    return;
  }

  renderMediaInto(mediaArea, currentLiveMedia);
  setStatus(`Mostrando ${currentLiveMedia.path.replace("/media/", "")}`);
  if (viewLiveButton) viewLiveButton.disabled = false;
};

const resetUpload = () => {
  currentUpload = null;
  renderUploadPlaceholder();
  setUploadMessage("Nenhum arquivo selecionado.");
  if (viewUploadButton) viewUploadButton.disabled = true;
  if (publishButton) publishButton.disabled = true;
  if (uploadInput) uploadInput.value = "";
  if (uploadUrl) {
    URL.revokeObjectURL(uploadUrl);
    uploadUrl = null;
  }
};

const showUpload = (file) => {
  if (!file) {
    resetUpload();
    return;
  }

  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = URL.createObjectURL(file);
  const kind = file.type.startsWith("video/") ? "video" : "image";

  currentUpload = { url: uploadUrl, kind, name: file.name, file };
  const prettySize = (file.size / (1024 * 1024)).toFixed(2);
  setUploadMessage(`Selecionado: ${file.name} (${prettySize} MB)`);
  renderMediaInto(uploadPreview, currentUpload);

  if (viewUploadButton) viewUploadButton.disabled = false;
  if (publishButton) publishButton.disabled = false;
};

const handleUploadChange = (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    resetUpload();
    return;
  }

  const allowed = ALLOWED_UPLOAD_MIMES.includes(file.type) || file.type.startsWith("video/");
  if (!allowed) {
    resetUpload();
    setUploadMessage("Formato não suportado. Use mp4 ou jpg/png/webp/gif/svg.", true);
    return;
  }

  showUpload(file);
};

const publishUpload = async () => {
  if (!currentUpload?.file) return;
  if (publishButton) publishButton.disabled = true;
  setUploadMessage("Enviando e publicando...");

  const formData = new FormData();
  formData.append("file", currentUpload.file);

  try {
    const response = await fetch(buildUrl("/api/upload"), {
      method: "POST",
      body: formData,
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || "Falha ao enviar. Verifique o backend.");
    }

    setUploadMessage("Publicado com sucesso! Atualizando visualização...");
    await loadMedia();
  } catch (error) {
    console.error(error);
    setUploadMessage(error.message || "Erro ao enviar. Confira API_BASE e CORS.", true);
  } finally {
    if (publishButton) publishButton.disabled = false;
  }
};

const openViewer = (source) => {
  if (!viewerOverlay || !viewerSlot || !source) return;
  viewerSlot.innerHTML = "";
  renderMediaInto(viewerSlot, source);
  viewerOverlay.classList.remove("hidden");
};

const closeViewer = () => {
  if (!viewerOverlay || !viewerSlot) return;
  viewerOverlay.classList.add("hidden");
  viewerSlot.innerHTML = "";
};

const init = () => {
  renderPlaceholder();
  resetUpload();
  loadMedia();

  if (refreshButton) refreshButton.addEventListener("click", () => loadMedia());
  if (viewLiveButton) viewLiveButton.addEventListener("click", () => openViewer(currentLiveMedia));
  if (uploadInput) uploadInput.addEventListener("change", handleUploadChange);
  if (chooseUploadButton) {
    chooseUploadButton.addEventListener("click", () => uploadInput?.click());
  }
  if (viewUploadButton) viewUploadButton.addEventListener("click", () => openViewer(currentUpload));
  if (publishButton) publishButton.addEventListener("click", publishUpload);
  if (closeViewerButton) closeViewerButton.addEventListener("click", closeViewer);

  if (viewerOverlay) {
    viewerOverlay.addEventListener("click", (event) => {
      const target = event.target;
      if (target === viewerOverlay || target.classList.contains("viewer-backdrop")) {
        closeViewer();
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeViewer();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      loadMedia();
    }
  });
};

window.addEventListener("DOMContentLoaded", init);
