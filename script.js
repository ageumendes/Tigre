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
const mediaTypeSelect = document.getElementById("media-type-select");
const passwordOverlay = document.getElementById("password-overlay");
const passwordInput = document.getElementById("password-input");
const passwordConfirm = document.getElementById("password-confirm");
const passwordCancel = document.getElementById("password-cancel");
const statusOverlay = document.getElementById("status-overlay");
const statusIcon = document.getElementById("status-icon");
const statusMessage = document.getElementById("status-message");

const viewerOverlay = document.getElementById("viewer-overlay");
const viewerSlot = document.getElementById("viewer-slot");
const closeViewerButton = document.getElementById("close-viewer");

// Promo admin elements
const promoStatus = document.getElementById("promo-admin-status");
const promoListAdmin = document.getElementById("promo-list-admin");
const promoForm = document.getElementById("promo-form");
const promoTitleInput = document.getElementById("promo-title");
const promoPriceInput = document.getElementById("promo-price");
const promoBadgeInput = document.getElementById("promo-badge");
const promoValidInput = document.getElementById("promo-valid");
const promoImageInput = document.getElementById("promo-image");
const promoActiveInput = document.getElementById("promo-active");
const promoDescriptionInput = document.getElementById("promo-description");
const promoSaveButton = document.getElementById("promo-save-button");
const promoCancelButton = document.getElementById("promo-cancel-edit");
const reloadPromosButton = document.getElementById("reload-promos-admin");

const ALLOWED_UPLOAD_MIMES = ["video/mp4", "image/jpeg", "image/png", "image/webp"];
let currentLiveMedia = null;
let currentUpload = null;
let uploadUrl = null;
let uploadUrls = [];
let selectedMediaType = "video";
let promoEditingId = null;
let promoCache = [];

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

const showStatusOverlay = (message, isSuccess = true) => {
  if (!statusOverlay || !statusIcon || !statusMessage) return;
  statusMessage.textContent = message;
  statusIcon.textContent = isSuccess ? "✓" : "!";
  statusIcon.classList.toggle("error", !isSuccess);
  statusOverlay.classList.remove("hidden");
  setTimeout(() => {
    statusOverlay.classList.add("hidden");
  }, 3000);
};

const requestPassword = () =>
  new Promise((resolve) => {
    if (!passwordOverlay || !passwordInput || !passwordConfirm || !passwordCancel) {
      const direct = window.prompt("Digite a senha para publicar a mídia:");
      resolve(direct || "");
      return;
    }
    passwordOverlay.classList.remove("hidden");
    passwordInput.value = "";
    passwordInput.focus();

    const close = (value) => {
      passwordOverlay.classList.add("hidden");
      resolve(value);
      passwordConfirm.removeEventListener("click", onConfirm);
      passwordCancel.removeEventListener("click", onCancel);
    };

    const onConfirm = () => close(passwordInput.value || "");
    const onCancel = () => close("");

    passwordConfirm.addEventListener("click", onConfirm);
    passwordCancel.addEventListener("click", onCancel);
    passwordOverlay.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "Enter") onConfirm();
        if (event.key === "Escape") onCancel();
      },
      { once: true }
    );
  });

const setPromoMessage = (message, isError = false) => {
  if (!promoStatus) return;
  promoStatus.textContent = message;
  promoStatus.classList.toggle("error", isError);
};

const updateMediaType = () => {
  selectedMediaType = mediaTypeSelect?.value || "video";
  if (uploadInput) uploadInput.multiple = selectedMediaType === "carousel";
  resetUpload();
  const hint =
    selectedMediaType === "carousel"
      ? "Selecione até 10 imagens para o carrossel."
      : "Nenhum arquivo selecionado.";
  setUploadMessage(hint);
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
  if (candidate.mode === "carousel") {
    const main = document.createElement("div");
    main.className = "placeholder";
    main.innerHTML = `
      <p>Carrossel com ${candidate.items?.length || 0} imagens.</p>
      <small>Visualize o primeiro item abaixo.</small>
    `;
    target.appendChild(main);

    const first = candidate.items?.[0];
    if (first) {
      const img = document.createElement("img");
      img.src = first.url || first.path;
      img.alt = first.path || "Carrossel";
      target.appendChild(img);
    }
    return;
  }

  if (candidate.kind === "video" || candidate.mode === "video") {
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
  const mode = data.mode || (data.mime && data.mime.startsWith("video/") ? "video" : "image");
  const items = (data.items || []).map((item) => ({
    ...item,
    url: item.path ? `${buildUrl(item.path)}?t=${Date.now()}` : "",
  }));
  const primary = items[0] || data;
  const mediaUrl = primary.path ? `${buildUrl(primary.path)}?t=${Date.now()}` : null;
  const kind = mode === "video" ? "video" : "image";
  return {
    url: mediaUrl,
    kind,
    mode,
    path: primary.path,
    mime: primary.mime,
    size: primary.size,
    updatedAt: primary.updatedAt,
    items,
  };
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
  const name = currentLiveMedia.path ? currentLiveMedia.path.replace("/media/", "") : "mídia atual";
  const modeLabel =
    currentLiveMedia.mode === "carousel"
      ? `Carrossel (${currentLiveMedia.items?.length || 0} imagens)`
      : currentLiveMedia.mode === "image"
      ? "Imagem"
      : "Vídeo";
  setStatus(`Mostrando ${name} — ${modeLabel}`);
  if (viewLiveButton) viewLiveButton.disabled = false;
};

const resetUpload = () => {
  currentUpload = null;
  uploadUrls.forEach((url) => URL.revokeObjectURL(url));
  uploadUrls = [];
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

const showUploadSelection = (files) => {
  if (!files || !files.length) {
    resetUpload();
    return;
  }

  const mode = selectedMediaType;
  uploadUrls.forEach((url) => URL.revokeObjectURL(url));
  uploadUrls = [];

  if (mode === "carousel") {
    const images = Array.from(files);
    uploadUrls = images.map((file) => URL.createObjectURL(file));
    currentUpload = {
      mode: "carousel",
      files: images,
      items: uploadUrls.map((url, idx) => ({ url, name: images[idx].name })),
    };
    const totalMb = images.reduce((acc, file) => acc + file.size, 0) / (1024 * 1024);
    setUploadMessage(`Selecionadas ${images.length} imagens (${totalMb.toFixed(2)} MB) para o carrossel.`);
    if (uploadPreview) {
      uploadPreview.innerHTML = "";
      const grid = document.createElement("div");
      grid.className = "promo-grid";
      currentUpload.items.forEach((item) => {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.name || "Imagem do carrossel";
        img.style.borderRadius = "10px";
        img.style.objectFit = "cover";
        img.style.height = "120px";
        img.style.width = "100%";
        grid.appendChild(img);
      });
      uploadPreview.appendChild(grid);
    }
    if (viewUploadButton) viewUploadButton.disabled = true;
    if (publishButton) publishButton.disabled = false;
    return;
  }

  const [file] = files;
  if (!file) {
    resetUpload();
    return;
  }

  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = URL.createObjectURL(file);
  const kind = file.type.startsWith("video/") ? "video" : "image";

  currentUpload = { url: uploadUrl, kind, mode, name: file.name, file };
  const prettySize = (file.size / (1024 * 1024)).toFixed(2);
  setUploadMessage(`Selecionado: ${file.name} (${prettySize} MB)`);
  renderMediaInto(uploadPreview, currentUpload);

  if (viewUploadButton) viewUploadButton.disabled = false;
  if (publishButton) publishButton.disabled = false;
};

const handleUploadChange = (event) => {
  const files = Array.from(event.target.files || []);
  if (!files.length) {
    resetUpload();
    return;
  }

  const mode = selectedMediaType;
  const isVideoMode = mode === "video";
  const isCarousel = mode === "carousel";

  if (isVideoMode) {
    const [file] = files;
    if (!file.type.startsWith("video/")) {
      resetUpload();
      setUploadMessage("Selecione um arquivo de vídeo MP4 para o modo Vídeo.", true);
      return;
    }
    showUploadSelection([file]);
    return;
  }

  if (isCarousel) {
    if (files.length > 10) {
      resetUpload();
      setUploadMessage("Envie no máximo 10 imagens para o carrossel.", true);
      return;
    }
    const invalid = files.some((file) => !file.type.startsWith("image/"));
    if (invalid) {
      resetUpload();
      setUploadMessage("O carrossel aceita apenas imagens (JPG, PNG, WebP).", true);
      return;
    }
    showUploadSelection(files);
    return;
  }

  // Modo imagem única
  const [file] = files;
  if (!file.type.startsWith("image/")) {
    resetUpload();
    setUploadMessage("Selecione uma imagem (JPG, PNG, WebP) para o modo Imagem.", true);
    return;
  }
  showUploadSelection([file]);
};

const publishUpload = async () => {
  if (!currentUpload) return;
  const mode = selectedMediaType;
  const isCarousel = mode === "carousel";

  const password = await requestPassword();
  if (!password) {
    setUploadMessage("Publicação cancelada: senha não informada.", true);
    return;
  }
  setUploadMessage("Senha aceita. Enviando e publicando...");

  const filesToSend = isCarousel ? currentUpload.files : [currentUpload.file];
  if (!filesToSend || !filesToSend.length) {
    setUploadMessage("Selecione arquivos antes de publicar.", true);
    return;
  }

  if (publishButton) publishButton.disabled = true;
  setUploadMessage("Enviando e publicando...");

  const formData = new FormData();
  if (isCarousel) {
    filesToSend.forEach((file) => formData.append("files", file));
  } else {
    formData.append("file", filesToSend[0]);
  }

  const endpoint = isCarousel ? "/api/upload-carousel" : "/api/upload";

  try {
    const response = await fetch(buildUrl(endpoint), {
      method: "POST",
      headers: { "x-upload-password": password },
      body: formData,
    });

    const data = await response.json().catch(() => null);
    if (response.status === 401) {
      showStatusOverlay("Senha incorreta. Publicação não autorizada.", false);
      throw new Error("Senha incorreta. Publicação não autorizada.");
    }
    if (!response.ok || !data?.ok) {
      throw new Error(data?.message || "Falha ao enviar. Verifique o backend.");
    }

    setUploadMessage("Publicado com sucesso! Atualizando visualização...");
    showStatusOverlay("Senha correta. Publicando...", true);
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

const formatDate = (value) => {
  if (!value) return "Sem validade";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

const renderPromoList = () => {
  if (!promoListAdmin) return;
  promoListAdmin.innerHTML = "";
  if (!promoCache.length) {
    promoListAdmin.innerHTML = `
      <div class="placeholder">
        <p>Nenhuma promoção cadastrada.</p>
        <small>Use o formulário abaixo para criar uma.</small>
      </div>
    `;
    return;
  }

  const rows = promoCache.map((promo) => {
    const status = promo.active === false ? "Inativa" : "Ativa";
    const validity = promo.validUntil ? `Até ${formatDate(promo.validUntil)}` : "Sem validade";
    const price = promo.price ? `Preço: ${promo.price}` : "Sem preço";
    const badge = promo.badge ? `• ${promo.badge}` : "";
    return `
      <div class="promo-row">
        <div>
          <p class="promo-row-title">${promo.title || "Promoção"}</p>
          <p class="promo-row-meta">${status} — ${validity} — ${price} ${badge}</p>
        </div>
        <div class="actions">
          <button class="ghost-button small" data-action="edit" data-id="${promo.id}">Editar</button>
          <button class="ghost-button small" data-action="delete" data-id="${promo.id}">Excluir</button>
        </div>
      </div>
    `;
  });

  promoListAdmin.innerHTML = rows.join("");
};

const resetPromoForm = () => {
  promoEditingId = null;
  if (promoForm) promoForm.reset();
  if (promoActiveInput) promoActiveInput.checked = true;
  if (promoSaveButton) promoSaveButton.textContent = "Salvar promoção";
  if (promoCancelButton) {
    promoCancelButton.setAttribute("aria-disabled", "true");
    promoCancelButton.disabled = true;
  }
};

const fillPromoForm = (promo) => {
  promoEditingId = promo?.id || null;
  if (promoTitleInput) promoTitleInput.value = promo?.title || "";
  if (promoPriceInput) promoPriceInput.value = promo?.price || "";
  if (promoBadgeInput) promoBadgeInput.value = promo?.badge || "";
  if (promoValidInput) promoValidInput.value = promo?.validUntil || "";
  if (promoImageInput) promoImageInput.value = promo?.imageUrl || "";
  if (promoDescriptionInput) promoDescriptionInput.value = promo?.description || "";
  if (promoActiveInput) promoActiveInput.checked = promo?.active !== false;
  if (promoSaveButton) promoSaveButton.textContent = promoEditingId ? "Salvar alterações" : "Salvar promoção";
  if (promoCancelButton) {
    promoCancelButton.removeAttribute("aria-disabled");
    promoCancelButton.disabled = false;
  }
};

const fetchPromosAdmin = async () => {
  if (!promoStatus) return;
  setPromoMessage("Carregando promoções...");
  try {
    const response = await fetch(buildUrl(`/api/promos?t=${Date.now()}`), { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao carregar promoções.");
    promoCache = data.promos || [];
    renderPromoList();
    setPromoMessage(`Promoções: ${promoCache.length}`);
  } catch (error) {
    console.error(error);
    setPromoMessage(error.message || "Erro ao carregar promoções.", true);
  }
};

const handlePromoSubmit = async (event) => {
  event.preventDefault();
  if (!promoForm) return;
  const title = (promoTitleInput?.value || "").trim();
  if (!title) {
    setPromoMessage("Título é obrigatório.", true);
    return;
  }

  const payload = {
    title,
    price: (promoPriceInput?.value || "").trim(),
    badge: (promoBadgeInput?.value || "").trim(),
    validUntil: (promoValidInput?.value || "").trim(),
    imageUrl: (promoImageInput?.value || "").trim(),
    description: (promoDescriptionInput?.value || "").trim(),
    active: !!promoActiveInput?.checked,
  };

  const method = promoEditingId ? "PUT" : "POST";
  const url = promoEditingId ? buildUrl(`/api/promos/${promoEditingId}`) : buildUrl("/api/promos");
  setPromoMessage(promoEditingId ? "Atualizando promoção..." : "Criando promoção...");

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao salvar promoção.");
    setPromoMessage("Promoção salva com sucesso.");
    resetPromoForm();
    await fetchPromosAdmin();
  } catch (error) {
    console.error(error);
    setPromoMessage(error.message || "Erro ao salvar promoção.", true);
  }
};

const deletePromo = async (id) => {
  if (!id) return;
  setPromoMessage("Removendo promoção...");
  try {
    const response = await fetch(buildUrl(`/api/promos/${id}`), { method: "DELETE" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao remover promoção.");
    setPromoMessage("Promoção removida.");
    await fetchPromosAdmin();
    if (promoEditingId === id) resetPromoForm();
  } catch (error) {
    console.error(error);
    setPromoMessage(error.message || "Erro ao remover promoção.", true);
  }
};

const handlePromoListClick = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;

  if (action === "edit") {
    const promo = promoCache.find((p) => p.id === id);
    if (promo) fillPromoForm(promo);
  }
  if (action === "delete") {
    const confirmDelete = window.confirm("Deseja remover esta promoção?");
    if (confirmDelete) deletePromo(id);
  }
};

const init = () => {
  renderPlaceholder();
  resetUpload();
  loadMedia();

  if (mediaTypeSelect) {
    selectedMediaType = mediaTypeSelect.value;
    updateMediaType();
    mediaTypeSelect.addEventListener("change", updateMediaType);
  }

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

  if (promoForm) {
    promoForm.addEventListener("submit", handlePromoSubmit);
    resetPromoForm();
    fetchPromosAdmin();
  }
  if (promoListAdmin) promoListAdmin.addEventListener("click", handlePromoListClick);
  if (promoCancelButton) {
    promoCancelButton.addEventListener("click", () => {
      resetPromoForm();
      setPromoMessage("Edição cancelada.");
    });
  }
  if (reloadPromosButton) reloadPromosButton.addEventListener("click", fetchPromosAdmin);
};

window.addEventListener("DOMContentLoaded", init);
