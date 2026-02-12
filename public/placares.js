const liveContainer = document.getElementById("scores-live");
const dayContainer = document.getElementById("scores-day");
const fonteEl = document.getElementById("scores-fonte");
const dataEl = document.getElementById("placares-data");
const statusEl = document.getElementById("scores-status");

const formatDateDisplay = (value) => {
  if (!value) return "Hoje";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
};

const FALLBACK_PLACARES = () => ({
  dataAtual: new Date().toISOString().slice(0, 10),
  fonte: "fallback",
  ao_vivo: [],
  jogos_do_dia: [],
  obs: "Dados indisponíveis, exibindo fallback seguro.",
});

const carregarPlacares = async () => {
  liveContainer.innerHTML = '<div class="message">Carregando jogos ao vivo...</div>';
  dayContainer.innerHTML = '<div class="message">Carregando jogos do dia...</div>';
  try {
    const response = await fetch("/api/placares");
    if (!response.ok) throw new Error("Falha ao buscar placares");
    const dados = await response.json();
    renderizarPlacares(dados);
  } catch (error) {
    console.error("[placares] erro:", error);
    const dados = FALLBACK_PLACARES();
    renderizarPlacares(dados);
    statusEl.textContent = "Dados indisponíveis, exibindo fallback.";
  }
};

const renderizarPlacares = (dados) => {
  const aoVivo = Array.isArray(dados.ao_vivo) ? dados.ao_vivo : [];
  const jogosDia = Array.isArray(dados.jogos_do_dia) ? dados.jogos_do_dia : [];
  dataEl.textContent = dados.dataAtual || "--/--/----";
  fonteEl.textContent = `Fonte: ${dados.fonte || "Não informado"}`;
  statusEl.textContent = "Atualizado agora";
  renderizarAoVivo(aoVivo);
  renderizarJogosDoDia(jogosDia);
};

const criarLinha = (campeonato, label, value, destaque = false) => {
  const item = document.createElement("div");
  item.className = `score-item ${destaque ? "score-live" : ""}`;
  item.innerHTML = `
    <div class="score-status">${campeonato || "–"}</div>
    <div class="score-row">
      <span>${label.left}</span>
      <strong>${value}</strong>
      <span>${label.right}</span>
    </div>
  `;
  return item;
};

const renderizarAoVivo = (itens) => {
  liveContainer.innerHTML = "";
  if (!itens.length) {
    liveContainer.innerHTML =
      '<div class="message">⚽ Nenhum jogo ao vivo no momento.</div>';
    return;
  }
  itens.forEach((jogo) => {
    const placar =
      jogo.placar && jogo.placar !== "0-0" && jogo.placar !== "0" ? jogo.placar : "–";
    const minuto = jogo.minuto ? `<div class="score-status">${jogo.minuto}</div>` : "";
    const dataTexto = formatDateDisplay(jogo.data);
    const node = document.createElement("div");
    node.className = "score-item score-live";
    node.innerHTML = `
      <div class="score-status">⚽ ${jogo.campeonato || "Competição"} — ${dataTexto}</div>
      <div class="score-row">
        <span>${jogo.time_casa || "Casa"}</span>
        <strong>${placar}</strong>
        <span>${jogo.time_fora || "Visitante"}</span>
      </div>
      ${minuto ? minuto : ""}
      <div class="score-status">${jogo.status || "Em andamento"}</div>
    `;
    liveContainer.appendChild(node);
  });
};

const renderizarJogosDoDia = (itens) => {
  dayContainer.innerHTML = "";
  if (!itens.length) {
    dayContainer.innerHTML =
      '<div class="message">📅 Nenhum jogo programado para hoje.</div>';
    return;
  }
  itens.forEach((jogo) => {
    const placar = jogo.placar || "–";
    const horario = jogo.horario || "--:--";
    const dataTexto = formatDateDisplay(jogo.data);
    const node = document.createElement("div");
    node.className = "score-item";
    node.innerHTML = `
      <div class="score-status">${jogo.campeonato || "Competição"} — ${dataTexto} — ${horario}</div>
      <div class="score-row">
        <span>${jogo.time_casa || "Casa"}</span>
        <strong>${placar}</strong>
        <span>${jogo.time_fora || "Visitante"}</span>
      </div>
      <div class="score-status">${jogo.status || "Programado"}</div>
    `;
    dayContainer.appendChild(node);
  });
};

document.addEventListener("DOMContentLoaded", () => {
  carregarPlacares();
  setInterval(carregarPlacares, 60 * 1000);
});
