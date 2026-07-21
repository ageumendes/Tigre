const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");

const byId = (id) => document.getElementById(id);
const summaryStatus = byId("summary-status");
const chartStatus = byId("chart-status");
const recentStatus = byId("recent-status");
const recentBody = byId("recent-body");
const chartCanvas = byId("chart-canvas");
const periodSelect = byId("period-days");
const refreshButton = byId("refresh-dashboard");
const ssidBreakdown = byId("ssid-breakdown");
const qualityStatus = byId("quality-status");

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
let adminPassword = sessionStorage.getItem("tv-admin-password") || "";
let latestSummary = null;

const setStatus = (element, message, isError = false) => {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("error", Boolean(isError));
};

const escapeHtml = (value) => `${value ?? ""}`
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#039;");

const formatNumber = (value) => new Intl.NumberFormat("pt-BR").format(Number(value) || 0);
const formatPercent = (value) => `${new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
}).format(Number(value) || 0)}%`;
const formatDateTime = (timestamp) => timestamp
  ? new Date(timestamp).toLocaleString("pt-BR")
  : "-";

const applyRoundedFavicon = () => {
  const link = document.querySelector('link[rel="icon"]');
  if (!link?.href) return;
  const image = new Image();
  image.decoding = "async";
  image.crossOrigin = "anonymous";
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.arc(32, 32, 32, 0, Math.PI * 2);
    context.clip();
    context.drawImage(image, 0, 0, 64, 64);
    link.href = canvas.toDataURL("image/png");
  };
  image.src = link.href;
};

const fetchJson = async (path) => {
  if (!adminPassword) {
    adminPassword = window.prompt("Informe a senha administrativa para acessar o dashboard:") || "";
    if (adminPassword) sessionStorage.setItem("tv-admin-password", adminPassword);
  }
  const response = await fetch(buildUrl(path), {
    cache: "no-store",
    headers: { "x-upload-password": adminPassword },
  });
  if (response.status === 401) {
    sessionStorage.removeItem("tv-admin-password");
    adminPassword = "";
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || "Não foi possível carregar os dados.");
  return data;
};

const setMetric = (id, value) => {
  const element = byId(id);
  if (element) element.textContent = value;
};

const drawTrendChart = (canvas, labels, views, connections) => {
  if (!canvas) return;
  const context = canvas.getContext("2d");
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 720;
  const height = canvas.clientHeight || 260;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { left: 42, right: 18, top: 24, bottom: 34 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(1, ...views, ...connections);

  context.font = "11px Manrope, sans-serif";
  context.fillStyle = "#6b5a45";
  context.strokeStyle = "rgba(0,0,0,.08)";
  context.lineWidth = 1;
  for (let step = 0; step <= 4; step += 1) {
    const y = padding.top + chartHeight * step / 4;
    const value = Math.round(maxValue * (1 - step / 4));
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.textAlign = "right";
    context.fillText(`${value}`, padding.left - 8, y + 4);
  }

  const xAt = (index) => labels.length <= 1
    ? padding.left + chartWidth / 2
    : padding.left + chartWidth * index / (labels.length - 1);
  const yAt = (value) => padding.top + chartHeight - (Number(value) || 0) / maxValue * chartHeight;
  const drawSeries = (values, color) => {
    context.strokeStyle = color;
    context.lineWidth = 3;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    values.forEach((value, index) => {
      const x = xAt(index);
      const y = yAt(value);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
    values.forEach((value, index) => {
      context.fillStyle = color;
      context.beginPath();
      context.arc(xAt(index), yAt(value), labels.length > 14 ? 2 : 3.5, 0, Math.PI * 2);
      context.fill();
    });
  };
  drawSeries(views, "#d62828");
  drawSeries(connections, "#16804a");

  const labelStep = labels.length > 14 ? 5 : 1;
  context.fillStyle = "#6b5a45";
  context.textAlign = "center";
  labels.forEach((label, index) => {
    if (index % labelStep !== 0 && index !== labels.length - 1) return;
    const [year, month, day] = label.split("-");
    context.fillText(`${day}/${month}`, xAt(index), height - 12);
  });
};

const renderSsidBreakdown = (bySsid = {}) => {
  if (!ssidBreakdown) return;
  const entries = Object.entries(bySsid).sort((a, b) => b[1] - a[1]);
  if (!entries.length) {
    ssidBreakdown.innerHTML = '<p class="muted">Nenhuma conexão registrada no período.</p>';
    return;
  }
  const total = entries.reduce((sum, [, count]) => sum + Number(count || 0), 0) || 1;
  ssidBreakdown.innerHTML = entries.map(([ssid, count]) => {
    const percent = Number(count || 0) / total * 100;
    return `<div class="ssid-row">
      <div class="ssid-row-head"><strong>${escapeHtml(ssid)}</strong><span>${formatNumber(count)} · ${formatPercent(percent)}</span></div>
      <div class="ssid-track"><span style="width:${Math.max(2, percent)}%"></span></div>
    </div>`;
  }).join("");
};

const renderSummary = (data) => {
  latestSummary = data;
  setMetric("metric-unique-devices", formatNumber(data.uniqueDevices));
  setMetric("metric-sessions", formatNumber(data.totalSessions));
  setMetric("metric-video-started", formatNumber(data.totalVideoStarted));
  setMetric("metric-completion-rate", formatPercent(data.completionRate));
  setMetric("metric-connect-clicked", formatNumber(data.totalConnectClicked));
  setMetric("metric-auth-redirect", formatNumber(data.totalAuthRedirect));
  setMetric("metric-download-clicked", formatNumber(data.totalDownloadClicked));
  setMetric("metric-share-clicked", formatNumber(data.totalShareClicked));
  setMetric("metric-connection-rate", `${formatPercent(data.connectionRate)} dos cliques avançaram para liberação`);

  const labels = Object.keys(data.byDayViews || {}).sort();
  const views = labels.map((key) => data.byDayViews[key] || 0);
  const connections = labels.map((key) => data.byDayConnections?.[key] || 0);
  drawTrendChart(chartCanvas, labels, views, connections);
  renderSsidBreakdown(data.bySsid || {});
  setStatus(summaryStatus, `${formatNumber(data.totalEvents)} eventos válidos no período selecionado.`);
  setStatus(chartStatus, labels.length ? "Dados consolidados por dia." : "Sem dados no período.");
  if (qualityStatus) {
    qualityStatus.innerHTML = `<strong>Qualidade dos dados</strong><span>${formatNumber(data.duplicatesRemoved)} evento(s) repetido(s) desconsiderado(s) das análises.</span>`;
  }
};

const EVENT_LABELS = {
  video_started: "Visualização iniciada",
  video_completed: "Mídia concluída",
  connect_clicked: "Clique em conectar",
  auth_redirect: "Liberação solicitada",
  download_clicked: "Download em JPG",
  share_clicked: "Compartilhamento",
};

const renderRecent = (events = []) => {
  if (!recentBody) return;
  if (!events.length) {
    recentBody.innerHTML = '<tr><td colspan="4" class="muted">Nenhum evento registrado.</td></tr>';
    return;
  }
  recentBody.innerHTML = events.slice(0, 50).map((event) => `<tr>
    <td><span class="event-badge event-${escapeHtml(event.type)}">${escapeHtml(EVENT_LABELS[event.type] || event.type || "-")}</span></td>
    <td>${escapeHtml(event.ssid || "-")}</td>
    <td><code>${escapeHtml(event.clientMac || event.clientIp || "-")}</code></td>
    <td>${escapeHtml(formatDateTime(event.timestamp))}</td>
  </tr>`).join("");
};

const loadDashboard = async () => {
  const days = Number(periodSelect?.value || 7) === 30 ? 30 : 7;
  refreshButton?.setAttribute("disabled", "disabled");
  setStatus(summaryStatus, "Carregando indicadores...");
  setStatus(recentStatus, "Carregando eventos recentes...");
  try {
    const [summary, recent] = await Promise.all([
      fetchJson(`/api/stats/summary?days=${days}&t=${Date.now()}`),
      fetchJson(`/api/stats/recent?limit=50&t=${Date.now()}`),
    ]);
    renderSummary(summary);
    renderRecent(recent.events || []);
    setStatus(recentStatus, `${formatNumber((recent.events || []).length)} eventos válidos mais recentes. Duplicidades históricas são ocultadas.`);
  } catch (error) {
    console.error(error);
    setStatus(summaryStatus, error.message || "Erro ao carregar indicadores.", true);
    setStatus(chartStatus, "Não foi possível montar o gráfico.", true);
    setStatus(recentStatus, error.message || "Erro ao carregar eventos.", true);
  } finally {
    refreshButton?.removeAttribute("disabled");
  }
};

periodSelect?.addEventListener("change", loadDashboard);
refreshButton?.addEventListener("click", loadDashboard);
window.addEventListener("resize", () => {
  if (!latestSummary) return;
  const labels = Object.keys(latestSummary.byDayViews || {}).sort();
  drawTrendChart(
    chartCanvas,
    labels,
    labels.map((key) => latestSummary.byDayViews[key] || 0),
    labels.map((key) => latestSummary.byDayConnections?.[key] || 0)
  );
});
window.addEventListener("DOMContentLoaded", () => {
  applyRoundedFavicon();
  loadDashboard();
});
