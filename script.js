const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const mediaArea = document.getElementById("media-area");
const statusLabel = document.getElementById("status");
const mediaStories = document.getElementById("media-stories");
const refreshButton = document.getElementById("refresh-button");
const viewLiveButton = document.getElementById("view-live-button");

const uploadInput = document.getElementById("upload-input");
const uploadLabel = document.querySelector(".upload-label");
const chooseUploadButton = document.getElementById("choose-upload-button");
const uploadStatus = document.getElementById("upload-status");
const uploadPreview = document.getElementById("upload-preview");
const viewUploadButton = document.getElementById("view-upload-button");
const publishButton = document.getElementById("publish-button");
const targetSelect = document.getElementById("target-select");
const passwordOverlay = document.getElementById("password-overlay");
const passwordInput = document.getElementById("password-input");
const passwordConfirm = document.getElementById("password-confirm");
const passwordCancel = document.getElementById("password-cancel");
const statusOverlay = document.getElementById("status-overlay");
const statusIcon = document.getElementById("status-icon");
const statusMessage = document.getElementById("status-message");
const loadingOverlay = document.getElementById("loading-overlay");
const loadingMessage = document.getElementById("loading-message");
let storyTimer = null;
let storyIndex = 0;
let storyDuration = 6000;

const viewerOverlay = document.getElementById("viewer-overlay");
const viewerSlot = document.getElementById("viewer-slot");
const closeViewerButton = document.getElementById("close-viewer");
const openTvOverlayButton = document.getElementById("open-tv-overlay");
const tvOverlay = document.getElementById("tv-overlay");
const tvOverlayClose = document.getElementById("tv-overlay-close");

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
const tvStatus = document.getElementById("tv-status");
const tvList = document.getElementById("tv-list");
const tvForm = document.getElementById("tv-form");
const tvNomeInput = document.getElementById("tv-nome");
const tvMarcaInput = document.getElementById("tv-marca");
const tvSaveButton = document.getElementById("tv-save-button");
const tvCancelButton = document.getElementById("tv-cancel-button");
const tvReloadButton = document.getElementById("tv-reload");
const statusExtra = document.getElementById("status-extra");
const statusTargetDetails = document.getElementById("status-target-details");
const statusExtraWeatherMain = document.getElementById("status-extra-weather-main");
const statusExtraWeatherMeta = document.getElementById("status-extra-weather-meta");
const statusExtraCommoditiesMain = document.getElementById("status-extra-commodities-main");
const statusExtraCommoditiesMeta = document.getElementById("status-extra-commodities-meta");
const statusExtraScoresMain = document.getElementById("status-extra-scores-main");
const statusExtraScoresMeta = document.getElementById("status-extra-scores-meta");

const ALLOWED_UPLOAD_MIMES = ["video/mp4", "image/jpeg", "image/png", "image/webp"];
let currentLiveMedia = null;
let currentUpload = null;
let uploadUrl = null;
let uploadUrls = [];
let selectedTarget = "todas";
let promoEditingId = null;
let promoCache = [];
let tvEditingId = null;
let tvCache = [];

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
const kindFromMime = (mime) => (mime && mime.startsWith("video/") ? "video" : "image");
const detectFileKind = (file) => {
  const name = (file?.name || "").toLowerCase();
  const type = file?.type || "";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("image/") || /\.(jpe?g|png|webp)$/i.test(name)) return "image";
  return "unknown";
};
// Campo target das mídias: todas ou valor livre normalizado
const normalizeTargetClient = (value) => {
  const val = (value || "").toString().trim().toLowerCase();
  return val || "todas";
};
const formatBytes = (bytes) => {
  if (!bytes && bytes !== 0) return null;
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
};
const formatDateTime = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
};
const normalizeMediaPayload = (data) => {
  if (!data) return null;
  const mode = data.mode || (data.mime && data.mime.startsWith("video/") ? "video" : "image");
  const items = (data.items || []).map((item) => ({
    ...item,
    url: item.path ? `${buildUrl(item.path)}?t=${Date.now()}` : "",
    kind: kindFromMime(item.mime),
  }));
  const primary = items[0] || data;
  const mediaUrl = primary.path ? `${buildUrl(primary.path)}?t=${Date.now()}` : data.url || "";
  const kind = mode === "video" ? "video" : "image";
  return {
    ...data,
    url: mediaUrl,
    kind,
    mode,
    items,
  };
};

const capitalizeLabel = (value) => {
  const text = (value || "").toString().trim();
  if (!text) return "";
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

const formatTargetLabel = (target) => {
  const normalized = normalizeTargetClient(target);
  if (normalized === "todas") return "Todas as TVs";
  const tv = tvCache.find(
    (item) =>
      normalizeTargetClient(item.tipo) === normalized ||
      normalizeTargetClient(item.nome) === normalized ||
      normalizeTargetClient(item.id) === normalized
  );
  const labelBase = tv ? tv.nome || tv.id || normalized : normalized;
  const brand = tv?.marca ? ` (${tv.marca})` : "";
  const cleaned = capitalizeLabel(labelBase);
  return `${cleaned}${brand}`;
};

const formatMediaName = (item) => {
  const source = item?.path || item?.url || "";
  const cleaned = source
    .toString()
    .split("/")
    .pop()
    ?.split("?")[0];
  return cleaned || item?.mime || "mídia";
};

const getMediaItems = () => {
  if (!currentLiveMedia) return [];
  return currentLiveMedia.items?.length ? currentLiveMedia.items : [currentLiveMedia];
};

const getLatestUpdatedLabel = (items = []) => {
  const timestamp = items.reduce((max, item) => Math.max(max, item?.updatedAt || 0), 0);
  return formatDateTime(timestamp) || "há pouco";
};

const updateStatusForTarget = () => {
  if (!currentLiveMedia) {
    setStatus("Nenhuma mídia publicada ainda.", true);
    return;
  }

  const items = getMediaItems();
  if (!items.length) {
    setStatus("Nenhuma mídia publicada ainda.", true);
    return;
  }

  const target = normalizeTargetClient(selectedTarget || "todas");
  const filtered =
    target === "todas" ? items : items.filter((item) => normalizeTargetClient(item.target) === target);

  if (!filtered.length) {
    setStatus(`Nenhuma mídia publicada para ${formatTargetLabel(target)}.`, true);
    return;
  }

  const count = filtered.length;
  const modeLabel =
    currentLiveMedia.mode === "carousel"
      ? `Carrossel (${count} imagem${count === 1 ? "" : "ens"})`
      : currentLiveMedia.mode === "image"
      ? "Imagem"
      : "Vídeo";
  const totalSize = filtered.reduce((acc, item) => acc + (item?.size || 0), 0);
  const sizeLabel = formatBytes(totalSize);
  const updatedLabel = getLatestUpdatedLabel(filtered);
  const summaryParts = [`${count} mídia${count === 1 ? "" : "s"}`, modeLabel, sizeLabel, `Atualizado ${updatedLabel}`].filter(Boolean);
  const primaryMessage = `${target === "todas" ? "Todas as TVs" : formatTargetLabel(target)} • ${summaryParts.join(" • ")}`;
  setStatus(primaryMessage);
};

const setStatus = (message, isError = false) => {
  if (!statusLabel) return;
  statusLabel.classList.toggle("error", isError);
  statusLabel.textContent = message;
};

const shouldShowExtraStatus = () => selectedTarget !== "roteador";

const updateCardContent = (mainElem, metaElem, mainText = "", metaText = "") => {
  if (mainElem) mainElem.textContent = mainText;
  if (metaElem) metaElem.textContent = metaText;
};

const clearStatusCards = () => {
  updateCardContent(statusExtraWeatherMain, statusExtraWeatherMeta, "", "");
  updateCardContent(statusExtraCommoditiesMain, statusExtraCommoditiesMeta, "", "");
  updateCardContent(statusExtraScoresMain, statusExtraScoresMeta, "", "");
};

const clearStatusTargetDetails = () => {
  if (!statusTargetDetails) return;
  statusTargetDetails.innerHTML = "";
  statusTargetDetails.classList.add("hidden");
};

const hideStatusExtra = () => {
  if (!statusExtra) return;
  statusExtra.classList.add("hidden");
  clearStatusTargetDetails();
  clearStatusCards();
};

const showStatusExtra = () => {
  if (!statusExtra) return;
  statusExtra.classList.remove("hidden");
};

const describeMediaKinds = (items = []) => {
  const normalized = items.map((item) => (item.kind || kindFromMime(item?.mime || "")).toLowerCase());
  const hasVideo = normalized.some((kind) => kind === "video");
  const hasImage = normalized.some((kind) => kind === "image");
  if (hasVideo && hasImage) return "Vídeos e imagens";
  if (hasVideo) return normalized.length === 1 ? "Vídeo" : "Vídeos";
  return "Imagens";
};

const renderStatusTargetDetails = () => {
  if (!statusTargetDetails) return;
  if (!shouldShowExtraStatus() || selectedTarget !== "todas" || !currentLiveMedia) {
    clearStatusTargetDetails();
    return;
  }
  const items = getMediaItems();
  if (!items.length) {
    clearStatusTargetDetails();
    return;
  }

  const grouped = items.reduce((acc, item) => {
    const target = normalizeTargetClient(item.target);
    if (!acc[target]) acc[target] = [];
    acc[target].push(item);
    return acc;
  }, {});

  const rows = Object.entries(grouped)
    .map(([target, group]) => ({ target, group, label: formatTargetLabel(target) }))
    .sort((a, b) => {
      if (a.target === "todas") return -1;
      if (b.target === "todas") return 1;
      return a.label.localeCompare(b.label);
    })
    .map(({ target, group, label }) => {
      const count = group.length;
      const kindLabel = describeMediaKinds(group);
      const updatedLabel = getLatestUpdatedLabel(group);
      return `
        <div class="status-target-row">
          <strong>${label}</strong>
          <span>${count} mídia${count === 1 ? "" : "s"} • ${kindLabel} • Atualizado ${updatedLabel}</span>
        </div>
      `;
    })
    .join("");

  statusTargetDetails.innerHTML = rows;
  statusTargetDetails.classList.remove("hidden");
};

const joinMetaParts = (parts = []) => parts.filter(Boolean).join(" • ");

const buildWeatherCard = (data) => {
  if (!data) return { main: "Sem dados climáticos", meta: "" };
  const main = `${data.location} • ${Math.round(data.current)}°C`;
  const forecast = Array.isArray(data.forecast)
    ? data.forecast
        .map((entry) => `${entry.day} ${Math.round(entry.high)}°/${Math.round(entry.low)}°`)
        .join(" • ")
    : "";
  return {
    main,
    meta: joinMetaParts([data.summary, forecast, data.updatedAt ? `Atualizado ${data.updatedAt}` : null]),
  };
};

const buildCommoditiesCard = (data) => {
  if (!data?.items?.length) return { main: "Sem dados de commodities", meta: "" };
  const main = data.items.slice(0, 4).map((item) => `${item.label} ${item.price}`).join(" • ");
  return {
    main,
    meta: joinMetaParts([data.market, data.updatedAt ? `Atualizado ${data.updatedAt}` : null]),
  };
};

const buildScoresCard = (data) => {
  if (!data?.matches?.length) return { main: "Sem placares para hoje", meta: "" };
  const main = data.matches
    .slice(0, 3)
    .map((match) => `${match.home} ${match.scoreHome} x ${match.scoreAway} ${match.away}`)
    .join(" | ");
  const meta = joinMetaParts([
    data.league,
    data.matches[0]?.status,
    data.updatedAt ? `Atualizado ${data.updatedAt}` : null,
  ]);
  return { main, meta };
};

const fetchExtraData = async (key) => {
  const path = `/api/extras/${key}`;
  const response = await fetch(buildUrl(`${path}?t=${Date.now()}`), { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  return data?.ok ? data : null;
};

const updateExtraStatus = async () => {
  if (!statusExtra) return;
  if (!shouldShowExtraStatus()) {
    hideStatusExtra();
    return;
  }
  showStatusExtra();
  renderStatusTargetDetails();

  let weather = null;
  let commodities = null;
  let scores = null;
  try {
    [weather, commodities, scores] = await Promise.all([
      fetchExtraData("weather"),
      fetchExtraData("commodities"),
      fetchExtraData("scores"),
    ]);
  } catch (error) {
    console.error("Erro ao carregar dados extras:", error);
  }

  const weatherCard = buildWeatherCard(weather);
  const commoditiesCard = buildCommoditiesCard(commodities);
  const scoresCard = buildScoresCard(scores);

  updateCardContent(statusExtraWeatherMain, statusExtraWeatherMeta, weatherCard.main, weatherCard.meta);
  updateCardContent(
    statusExtraCommoditiesMain,
    statusExtraCommoditiesMeta,
    commoditiesCard.main,
    commoditiesCard.meta
  );
  updateCardContent(statusExtraScoresMain, statusExtraScoresMeta, scoresCard.main, scoresCard.meta);
};

const showTvOverlay = () => {
  if (!tvOverlay) return;
  tvOverlay.classList.remove("hidden");
  tvOverlay.setAttribute("aria-hidden", "false");
};
const hideTvOverlay = () => {
  if (!tvOverlay) return;
  tvOverlay.classList.add("hidden");
  tvOverlay.setAttribute("aria-hidden", "true");
};

const applyRoundedFavicon = () => {
  const link = document.querySelector('link[rel="icon"]');
  if (!link || !link.href) return;
  const img = new Image();
  img.decoding = "async";
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

const setTvMessage = (message, isError = false) => {
  if (!tvStatus) return;
  tvStatus.textContent = message;
  tvStatus.classList.toggle("error", isError);
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

const renderStories = (media) => {
  if (!mediaStories) return;
  clearStoryAutoplay();
  mediaStories.innerHTML = "";
  const items = media?.items?.length ? media.items : media ? [media] : [];
  mediaStories.classList.toggle("centered", items.length === 1);

  if (!items.length) {
    mediaStories.innerHTML = `
      <div class="placeholder">
        <p>Nenhuma mídia publicada.</p>
        <small>Envie um arquivo para aparecer aqui.</small>
      </div>
    `;
    return;
  }

  items.forEach((item, index) => {
    const url = item.url || (item.path ? `${buildUrl(item.path)}?t=${Date.now()}` : "");
    const kind = kindFromMime(item.mime || media?.mime);
    const label = item.path
      ? item.path.replace("/media/", "")
      : kind === "video"
      ? `Vídeo ${index + 1}`
      : `Imagem ${index + 1}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "story";
    button.dataset.kind = kind;
    if (url) button.style.setProperty("--thumb", `url('${url}')`);
    button.innerHTML = `
      <span class="story-ring">
        <span class="story-thumb" aria-hidden="true"></span>
      </span>
    `;
    button.setAttribute("aria-label", label);
    button.title = label;
    button.dataset.index = index.toString();
    button.addEventListener("click", () => {
      openStoryAt(index);
    });
    mediaStories.appendChild(button);
  });
  setActiveStory(0);
  renderStoryProgress(items.length);
};

const showStoriesLoading = () => {
  if (!mediaStories) return;
  mediaStories.innerHTML = `
    <div class="spinner" role="status" aria-label="Carregando mídias"></div>
  `;
};

const setActiveStory = (index) => {
  const buttons = Array.from(mediaStories?.querySelectorAll(".story") || []);
  buttons.forEach((btn, idx) => btn.classList.toggle("story-active", idx === index));
};

const renderStoryProgress = (count) => {
  const container = document.getElementById("story-progress");
  if (!container) return;
  container.innerHTML = "";
  if (!count || count < 2) return;
  for (let i = 0; i < count; i += 1) {
    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    fill.className = "bar-fill";
    bar.appendChild(fill);
    container.appendChild(bar);
  }
};

const updateProgressBars = (count, activeIndex) => {
  const container = document.getElementById("story-progress");
  if (!container) return;
  const bars = Array.from(container.querySelectorAll(".bar-fill"));
  bars.forEach((fill, idx) => {
    if (idx < activeIndex) {
      fill.style.width = "100%";
    } else if (idx === activeIndex) {
      fill.style.width = "0%";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fill.style.transition = `width ${storyDuration}ms linear`;
          fill.style.width = "100%";
        });
      });
    } else {
      fill.style.width = "0%";
      fill.style.transition = "none";
    }
  });
};

const clearStoryAutoplay = () => {
  if (storyTimer) {
    clearTimeout(storyTimer);
    storyTimer = null;
  }
};

const getStoryItems = () => {
  if (!currentLiveMedia) return [];
  const items = currentLiveMedia.items?.length ? currentLiveMedia.items : [currentLiveMedia];
  return items.map((item) => ({
    ...item,
    url: item.url || (item.path ? `${buildUrl(item.path)}?t=${Date.now()}` : ""),
    kind: item.kind || kindFromMime(item.mime || currentLiveMedia.mime),
  }));
};

const openStoryAt = (index) => {
  const items = getStoryItems();
  if (!items.length) return;
  const safeIndex = ((index % items.length) + items.length) % items.length;
  storyIndex = safeIndex;
  const item = items[safeIndex];
  openViewer({ url: item.url, kind: item.kind, mode: item.kind });
  setActiveStory(safeIndex);
  updateProgressBars(items.length, safeIndex);
  clearStoryAutoplay();
  if (items.length > 1) {
    storyTimer = setTimeout(() => openStoryAt(safeIndex + 1), storyDuration);
  }
};

const showLoadingOverlay = (message = "Processando...") => {
  if (!loadingOverlay || !loadingMessage) return;
  loadingMessage.textContent = message;
  loadingOverlay.classList.remove("hidden");
};

const hideLoadingOverlay = () => {
  if (!loadingOverlay) return;
  loadingOverlay.classList.add("hidden");
};

const fetchLatestInfo = async (target = selectedTarget) => {
  const params = new URLSearchParams({ t: Date.now().toString() });
  if (target) params.set("target", target);
  const url = buildUrl(`/api/info?${params.toString()}`);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) return null;
  const data = await response.json();
  return normalizeMediaPayload(data);
};

const loadMedia = async (options = {}) => {
  const { preserveStories = false, target = selectedTarget } = options;
  setStatus("Procurando arquivo...");
  if (viewLiveButton) viewLiveButton.disabled = true;
  if (!preserveStories) showStoriesLoading();

  try {
    currentLiveMedia = await fetchLatestInfo(target);
  } catch (error) {
    setStatus("Erro ao contactar o backend. Verifique API_BASE em config.js.", true);
    renderPlaceholder();
    if (!preserveStories) renderStories(null);
    return;
  }

  if (!currentLiveMedia) {
    if (!preserveStories) {
      renderPlaceholder();
      setStatus("Nenhuma mídia publicada ainda.", true);
      renderStories(null);
    }
    return;
  }

  selectedTarget = target;
  if (targetSelect) {
    const normalized = normalizeTargetClient(target);
    if (Array.from(targetSelect.options).some((opt) => opt.value === normalized)) {
      targetSelect.value = normalized;
    }
  }

  renderMediaInto(mediaArea, currentLiveMedia);
  renderStories(currentLiveMedia);
  const applyTargetFromLive = () => {
    if (!targetSelect || !currentLiveMedia) return;
    const first = currentLiveMedia.items?.[0] || currentLiveMedia;
    const target = normalizeTargetClient(first?.target);
    // Garante que o seletor de TVs tenha a opção corrente
    const exists = Array.from(targetSelect.options).some((opt) => opt.value === target);
    if (!exists) {
      const option = document.createElement("option");
      option.value = target;
      option.textContent = first?.targetLabel || target;
      targetSelect.appendChild(option);
    }
  };
  applyTargetFromLive();
  updateStatusForTarget();
  updateExtraStatus();
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

  uploadUrls.forEach((url) => URL.revokeObjectURL(url));
  uploadUrls = [];

  const list = Array.from(files);
  const kinds = list.map(detectFileKind);
  const hasVideo = kinds.includes("video");
  const hasUnknown = kinds.includes("unknown");

  if (list.length > 1) {
    if (hasVideo || hasUnknown) {
      resetUpload();
      setUploadMessage("Para carrossel, envie apenas imagens.", true);
      return;
    }
    uploadUrls = list.map((file) => URL.createObjectURL(file));
    currentUpload = {
      mode: "carousel",
      files: list,
      items: uploadUrls.map((url, idx) => ({ url, name: list[idx].name, kind: kinds[idx] })),
    };
    const totalMb = list.reduce((acc, file) => acc + file.size, 0) / (1024 * 1024);
    setUploadMessage(`Selecionadas ${list.length} mídias (${totalMb.toFixed(2)} MB).`);
    if (uploadPreview) {
      uploadPreview.innerHTML = "";
      const grid = document.createElement("div");
      grid.className = "carousel-preview";
      currentUpload.items.forEach((item, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "preview-item";
        const content = document.createElement(item.kind === "image" ? "img" : "div");
        if (item.kind === "image") {
          content.src = item.url;
          content.alt = item.name || "Imagem do carrossel";
        } else {
          content.className = "placeholder";
          content.innerHTML = `<p>${item.name}</p><small>Pré-visualização indisponível.</small>`;
        }
        if (item.kind === "image") {
          content.className = "carousel-img";
        }
        wrapper.appendChild(content);
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "remove-thumb";
        removeButton.innerHTML = "×";
        removeButton.title = "Remover esta mídia";
        removeButton.addEventListener("click", () => removeUploadItem(idx));
        wrapper.appendChild(removeButton);
        grid.appendChild(wrapper);
      });
      uploadPreview.appendChild(grid);
    }
    if (viewUploadButton) viewUploadButton.disabled = false;
    if (publishButton) publishButton.disabled = false;
    return;
  }

  const [file] = list;
  if (!file) {
    resetUpload();
    return;
  }

  const kind = detectFileKind(file);
  if (kind === "unknown") {
    resetUpload();
    setUploadMessage("Tipo de arquivo não suportado. Envie vídeo MP4 ou imagem.", true);
    return;
  }

  if (uploadUrl) URL.revokeObjectURL(uploadUrl);
  uploadUrl = URL.createObjectURL(file);
  const mode = kind === "video" ? "video" : "image";

  currentUpload = { url: uploadUrl, kind: mode, mode, name: file.name, file, files: [file] };
  const prettySize = (file.size / (1024 * 1024)).toFixed(2);
  setUploadMessage(`Selecionado: ${file.name} (${prettySize} MB).`);
  if (uploadPreview) {
    uploadPreview.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "preview-item";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "remove-thumb";
    removeButton.innerHTML = "×";
    removeButton.title = "Remover esta mídia";
    removeButton.addEventListener("click", () => resetUpload());

    if (mode === "video") {
      const video = document.createElement("video");
      video.src = currentUpload.url;
      video.controls = true;
      video.playsInline = true;
      video.preload = "auto";
      video.poster = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
      wrapper.appendChild(video);
    } else {
      const img = document.createElement("img");
      img.src = currentUpload.url;
      img.alt = currentUpload.name || "Pré-visualização";
      wrapper.appendChild(img);
    }
    wrapper.appendChild(removeButton);
    uploadPreview.appendChild(wrapper);
  }

  if (viewUploadButton) viewUploadButton.disabled = false;
  if (publishButton) publishButton.disabled = false;
};

const removeUploadItem = (index) => {
  if (!currentUpload) return;
  if (currentUpload.mode === "carousel") {
    if (!Array.isArray(currentUpload.files)) return;
    const files = [...currentUpload.files];
    const urls = [...uploadUrls];
    const removedUrl = urls[index];
    files.splice(index, 1);
    urls.splice(index, 1);
    if (removedUrl) URL.revokeObjectURL(removedUrl);
    if (!files.length) {
      resetUpload();
      return;
    }
    currentUpload.files = files;
    uploadUrls = urls;
    showUploadSelection(files);
    return;
  }
  resetUpload();
};

const handleUploadChange = (event) => {
  showLoadingOverlay("Carregando seleção...");
  try {
    const files = Array.from(event.target.files || []);
    if (!files.length) {
      resetUpload();
      return;
    }

    if (files.length > 100) {
      resetUpload();
      setUploadMessage("Envie no máximo 100 mídias por vez.", true);
      return;
    }

    const kinds = files.map(detectFileKind);
    if (kinds.includes("unknown")) {
      resetUpload();
      setUploadMessage("Tipo de arquivo não suportado. Envie vídeo MP4 ou imagem.", true);
      return;
    }

    const hasVideo = kinds.includes("video");
    if (files.length > 1 && hasVideo) {
      resetUpload();
      setUploadMessage("Vídeo deve ser enviado individualmente. Para carrossel use apenas imagens.", true);
      return;
    }

    if (hasVideo) {
      const [file] = files;
      const name = (file.name || "").toLowerCase();
      if (!name.endsWith(".mp4")) {
        resetUpload();
        setUploadMessage("Apenas vídeo MP4 é aceito.", true);
        return;
      }
      showUploadSelection([file]);
      return;
    }

    showUploadSelection(files);
  } finally {
    hideLoadingOverlay();
  }
};

const addUploadDragAndDrop = () => {
  if (!uploadLabel) return;
  const highlight = () => uploadLabel.classList.add("dragging");
  const unhighlight = () => uploadLabel.classList.remove("dragging");
  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const handleDrop = (event) => {
    prevent(event);
    unhighlight();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    handleUploadChange({ target: { files } });
  };

  ["dragenter", "dragover"].forEach((type) => {
    uploadLabel.addEventListener(type, (event) => {
      prevent(event);
      highlight();
    });
  });
  ["dragleave", "drop"].forEach((type) => {
    uploadLabel.addEventListener(type, (event) => {
      prevent(event);
      unhighlight();
    });
  });
  uploadLabel.addEventListener("drop", handleDrop);
};

const publishUpload = async () => {
  if (!currentUpload) return;
  const isCarousel = currentUpload.mode === "carousel" || (currentUpload.files && currentUpload.files.length > 1);
  const target = normalizeTargetClient(selectedTarget);

  const password = await requestPassword();
  if (!password) {
    setUploadMessage("Publicação cancelada: senha não informada.", true);
    return;
  }
  setUploadMessage("Senha aceita. Enviando e publicando...");
  showLoadingOverlay("Enviando mídia...");

  const filesToSend = currentUpload.files || (currentUpload.file ? [currentUpload.file] : []);
  if (!filesToSend || !filesToSend.length) {
    setUploadMessage("Selecione arquivos antes de publicar.", true);
    return;
  }

  if (publishButton) publishButton.disabled = true;
  setUploadMessage("Enviando e publicando...");

  const formData = new FormData();
  formData.append("target", target);
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

    const liveMedia = normalizeMediaPayload(data);
    if (liveMedia) {
      currentLiveMedia = liveMedia;
      renderStories(liveMedia);
    }

    await loadMedia({ preserveStories: true });
    resetUpload();
    setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    console.error(error);
    setUploadMessage(error.message || "Erro ao enviar. Confira API_BASE e CORS.", true);
  } finally {
    if (publishButton) publishButton.disabled = false;
    hideLoadingOverlay();
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
  clearStoryAutoplay();
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

// TVs configuráveis para Roku
const resetTvForm = () => {
  tvEditingId = null;
  if (tvForm) tvForm.reset();
  if (tvNomeInput) tvNomeInput.value = "";
  if (tvMarcaInput) tvMarcaInput.value = "";
  if (tvSaveButton) tvSaveButton.textContent = "Salvar TV";
  if (tvCancelButton) {
    tvCancelButton.setAttribute("aria-disabled", "true");
    tvCancelButton.disabled = true;
  }
};

const fillTvForm = (tv) => {
  tvEditingId = tv?.id || null;
  if (tvNomeInput) tvNomeInput.value = tv?.nome || "";
  if (tvMarcaInput) tvMarcaInput.value = tv?.marca || "";
  if (tvSaveButton) tvSaveButton.textContent = "Salvar alterações";
  if (tvCancelButton) {
    tvCancelButton.removeAttribute("aria-disabled");
    tvCancelButton.disabled = false;
  }
};

const renderTvList = () => {
  if (!tvList) return;
  tvList.innerHTML = "";
  if (!tvCache.length) {
    tvList.innerHTML = `
      <div class="placeholder">
        <p>Nenhuma TV cadastrada.</p>
        <small>Use o formulário abaixo para criar uma.</small>
      </div>
    `;
    return;
  }

  const rows = tvCache.map((tv) => {
    const tipoLabel = (tv.nome || tv.tipo || "").toString();
    return `
      <div class="promo-row">
        <div>
          <p class="promo-row-title">${tv.nome || tv.id}</p>
          <p class="promo-row-meta">ID: ${tv.id || "-"} — Tipo: ${tipoLabel} — Marca: ${tv.marca || "-"}</p>
        </div>
        <div class="actions">
          <button class="ghost-button small" data-action="edit-tv" data-id="${tv.id}">Editar</button>
        </div>
      </div>
    `;
  });
  tvList.innerHTML = rows.join("");
};

const fetchTvsAdmin = async () => {
  if (!tvStatus) return;
  setTvMessage("Carregando TVs...");
  try {
    const response = await fetch(buildUrl(`/api/roku/tvs?t=${Date.now()}`), { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao carregar TVs.");
    tvCache = data.tvs || [];
    renderTvList();
    setTvMessage(`TVs: ${tvCache.length}`);
    rebuildTargetSelect();
  } catch (error) {
    console.error(error);
    setTvMessage(error.message || "Erro ao carregar TVs.", true);
  }
};

const saveTv = async (event) => {
  event.preventDefault();
  if (!tvForm) return;
  const nome = (tvNomeInput?.value || "").trim();
  const marca = (tvMarcaInput?.value || "").trim();
  const tipo = normalizeTargetClient(nome);
  const payloadId = tvEditingId || "";

  if (!nome || !marca) {
    setTvMessage("Informe nome e marca para salvar a TV.", true);
    return;
  }

  const password = await requestPassword();
  if (!password) {
    setTvMessage("Operação cancelada: senha não informada.", true);
    return;
  }

  setTvMessage(tvEditingId ? "Atualizando TV..." : "Criando TV...");
  const payload = { id: payloadId, nome, tipo, marca };
  const method = tvEditingId ? "PUT" : "POST";
  const url = tvEditingId ? buildUrl(`/api/roku/tvs/${tvEditingId}`) : buildUrl("/api/roku/tvs");

  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-upload-password": password,
      },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => null);
    if (response.status === 401) throw new Error("Senha incorreta para salvar TVs.");
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao salvar TV.");
    setTvMessage("TV salva com sucesso.");
    resetTvForm();
    await fetchTvsAdmin();
  } catch (error) {
    console.error(error);
    setTvMessage(error.message || "Erro ao salvar TV.", true);
  }
};

const handleTvListClick = (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) return;
  if (action === "edit-tv") {
    const tv = tvCache.find((item) => item.id === id);
    if (tv) fillTvForm(tv);
  }
};

const rebuildTargetSelect = () => {
  if (!targetSelect) return;
  const current = targetSelect.value;
  const options = [{ label: "Todas as TVs", value: "todas" }, ...tvCache.map((tv) => ({
    label: tv.marca ? `${tv.nome || tv.id} (${tv.marca})` : (tv.nome || tv.id),
    value: normalizeTargetClient(tv.tipo || tv.nome),
  }))];
  const hasCurrent = options.some((opt) => opt.value === current);
  if (current && !hasCurrent) {
    options.push({ label: current, value: current });
  }
  targetSelect.innerHTML = "";
  options.forEach((opt) => {
    const option = document.createElement("option");
    option.value = opt.value;
    option.textContent = opt.label;
    targetSelect.appendChild(option);
  });
  const found = options.find((opt) => opt.value === current);
  targetSelect.value = found ? found.value : "todas";
  selectedTarget = targetSelect.value;
  updateStatusForTarget();
};

const init = () => {
  applyRoundedFavicon();
  renderPlaceholder();
  resetUpload();
  loadMedia();

  if (targetSelect) {
    selectedTarget = normalizeTargetClient(targetSelect.value);
    targetSelect.addEventListener("change", (event) => {
      const normalized = normalizeTargetClient(event.target.value);
      selectedTarget = normalized;
      loadMedia({ target: normalized });
    });
  }

  if (refreshButton) refreshButton.addEventListener("click", () => loadMedia());
  if (viewLiveButton) viewLiveButton.addEventListener("click", () => openStoryAt(0));
  if (uploadInput) uploadInput.addEventListener("change", handleUploadChange);
  if (chooseUploadButton) {
    chooseUploadButton.addEventListener("click", () => uploadInput?.click());
  }
  addUploadDragAndDrop();
  if (viewUploadButton) viewUploadButton.addEventListener("click", () => openViewer(currentUpload));
  if (publishButton) publishButton.addEventListener("click", publishUpload);
  const prevNav = document.querySelector(".story-nav.prev");
  const nextNav = document.querySelector(".story-nav.next");
  if (prevNav) prevNav.addEventListener("click", () => openStoryAt(storyIndex - 1));
  if (nextNav) nextNav.addEventListener("click", () => openStoryAt(storyIndex + 1));
  if (closeViewerButton) closeViewerButton.addEventListener("click", closeViewer);

  if (openTvOverlayButton) openTvOverlayButton.addEventListener("click", showTvOverlay);
  if (tvOverlayClose) tvOverlayClose.addEventListener("click", hideTvOverlay);
  if (tvOverlay) {
    const backdrop = tvOverlay.querySelector(".overlay-backdrop");
    tvOverlay.addEventListener("click", (event) => {
      if (event.target === tvOverlay || event.target === backdrop) {
        hideTvOverlay();
      }
    });
  }

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

  if (tvForm) {
    tvForm.addEventListener("submit", saveTv);
    resetTvForm();
    fetchTvsAdmin();
  }
  if (tvList) tvList.addEventListener("click", handleTvListClick);
  if (tvCancelButton) {
    tvCancelButton.addEventListener("click", () => {
      resetTvForm();
      setTvMessage("Edição cancelada.");
    });
  }
  if (tvReloadButton) tvReloadButton.addEventListener("click", fetchTvsAdmin);
};

window.addEventListener("DOMContentLoaded", init);
