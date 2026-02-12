const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");

const metricVideoStarted = document.getElementById("metric-video-started");
const metricConnectClicked = document.getElementById("metric-connect-clicked");
const metricAuthRedirect = document.getElementById("metric-auth-redirect");
const metricDownloadClicked = document.getElementById("metric-download-clicked");
const metricShareClicked = document.getElementById("metric-share-clicked");
const summaryStatus = document.getElementById("summary-status");
const chartStatus = document.getElementById("chart-status");
const recentStatus = document.getElementById("recent-status");
const recentBody = document.getElementById("recent-body");
const chartCanvas = document.getElementById("chart-canvas");

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

const setStatus = (el, message, isError = false) => {
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("error", !!isError);
};

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

const formatNumber = (value) => new Intl.NumberFormat("pt-BR").format(value || 0);

const formatDateTime = (timestamp) => {
  if (!timestamp) return "-";
  const date = new Date(timestamp);
  return date.toLocaleString("pt-BR");
};

const fetchJson = async (path) => {
  const response = await fetch(buildUrl(path), { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    throw new Error(data?.message || "Não foi possível carregar os dados.");
  }
  return data;
};

const drawBarChart = (canvas, labels, values) => {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const deviceRatio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 600;
  const height = canvas.clientHeight || 240;
  canvas.width = width * deviceRatio;
  canvas.height = height * deviceRatio;
  ctx.scale(deviceRatio, deviceRatio);
  ctx.clearRect(0, 0, width, height);

  if (!labels.length) {
    ctx.fillStyle = "#4d3410";
    ctx.font = "14px Manrope, sans-serif";
    ctx.fillText("Sem dados para exibir.", 12, 24);
    return;
  }

  const paddingX = 24;
  const paddingY = 24;
  const chartWidth = width - paddingX * 2;
  const chartHeight = height - paddingY * 2 - 20;
  const maxValue = Math.max(...values, 1);
  const barGap = 12;
  const barWidth = (chartWidth - barGap * (labels.length - 1)) / labels.length;

  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(paddingX, height - paddingY);
  ctx.lineTo(width - paddingX, height - paddingY);
  ctx.stroke();

  labels.forEach((label, index) => {
    const value = values[index] || 0;
    const barHeight = (value / maxValue) * chartHeight;
    const x = paddingX + index * (barWidth + barGap);
    const y = height - paddingY - barHeight;

    ctx.fillStyle = "rgba(214, 40, 40, 0.8)";
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#1c1200";
    ctx.font = "13px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(value), x + barWidth / 2, y - 6);

    ctx.fillStyle = "#4d3410";
    ctx.font = "12px Manrope, sans-serif";
    ctx.save();
    ctx.translate(x + barWidth / 2, height - paddingY + 16);
    ctx.rotate(-0.2);
    ctx.fillText(label.slice(5), 0, 0);
    ctx.restore();
  });
};

const loadSummary = async () => {
  setStatus(summaryStatus, "Carregando resumo...");
  const data = await fetchJson(`/api/stats/summary?t=${Date.now()}`);
  if (!data?.ok) throw new Error("Resposta inválida do resumo.");

  if (metricVideoStarted) metricVideoStarted.textContent = formatNumber(data.totalVideoStarted);
  if (metricConnectClicked) metricConnectClicked.textContent = formatNumber(data.totalConnectClicked);
  if (metricAuthRedirect) metricAuthRedirect.textContent = formatNumber(data.totalAuthRedirect);
  if (metricDownloadClicked) metricDownloadClicked.textContent = formatNumber(data.totalDownloadClicked);
  if (metricShareClicked) metricShareClicked.textContent = formatNumber(data.totalShareClicked);

  const byDay = data.byDay || {};
  const labels = Object.keys(byDay).sort();
  const values = labels.map((key) => byDay[key] || 0);
  drawBarChart(chartCanvas, labels, values);

  setStatus(summaryStatus, `Total de eventos: ${formatNumber(data.totalEvents || 0)}`);
  setStatus(chartStatus, labels.length ? " " : "Sem eventos nos últimos 7 dias.");
};

const renderRecent = (events) => {
  if (!recentBody) return;
  recentBody.innerHTML = "";
  if (!events?.length) {
    recentBody.innerHTML = `<tr><td colspan="4" class="muted">Nenhum evento registrado.</td></tr>`;
    return;
  }

  const rows = events.slice(0, 50).map((event) => {
    const type = event.type || "-";
    const ssid = event.ssid || "-";
    const mac = event.clientMac || "-";
    const time = formatDateTime(event.timestamp);
    return `<tr>
      <td>${type}</td>
      <td>${ssid}</td>
      <td>${mac}</td>
      <td>${time}</td>
    </tr>`;
  });
  recentBody.innerHTML = rows.join("");
};

const loadRecent = async () => {
  setStatus(recentStatus, "Carregando eventos recentes...");
  const data = await fetchJson(`/api/stats/recent?limit=50&t=${Date.now()}`);
  if (!data?.ok) throw new Error("Resposta inválida ao listar eventos.");
  renderRecent(data.events || []);
  setStatus(recentStatus, `Exibindo ${Math.min((data.events || []).length, 50)} eventos mais recentes.`);
};

const init = async () => {
  applyRoundedFavicon();
  try {
    await loadSummary();
  } catch (error) {
    console.error(error);
    setStatus(summaryStatus, error.message || "Erro ao carregar resumo.", true);
    setStatus(chartStatus, "Erro ao carregar gráfico.", true);
  }

  try {
    await loadRecent();
  } catch (error) {
    console.error(error);
    setStatus(recentStatus, error.message || "Erro ao carregar eventos.", true);
  }
};

window.addEventListener("DOMContentLoaded", init);
