const iconeElement = document.getElementById("icone-cidade");
const condicaoElement = document.getElementById("condicao");
const temperaturaElement = document.getElementById("temperatura-atual");
const sensacaoElement = document.getElementById("sensacao");
const umidadeElement = document.getElementById("umidade");
const ventoElement = document.getElementById("vento");
const fonteElement = document.getElementById("fonte");
const proximasHorasList = document.getElementById("proximas-horas");
const dataAtualElement = document.getElementById("data-atual");
const horaAtualElement = document.getElementById("hora-atual");
const tomorrowSection = document.getElementById("weather-tomorrow");

const escolherIcone = (condicao) => {
  if (!condicao) return "icon-cloud";
  const texto = condicao.toLowerCase();
  if (texto.includes("sol") || texto.includes("ensolarado")) return "icon-sun";
  if (texto.includes("tempestade") || texto.includes("trovoada")) return "icon-storm";
  if (texto.includes("chuva")) return "icon-rain";
  if (texto.includes("neblina") || texto.includes("névoa") || texto.includes("nevoeiro")) return "icon-fog";
  if (texto.includes("nublado") || texto.includes("nuvem")) return "icon-cloud";
  return "icon-cloud";
};

const formatarData = (value) => {
  if (!value) return "--/--/----";
  const partes = value.split("-");
  if (partes.length !== 3) return value;
  return `${partes[2]}/${partes[1]}/${partes[0]}`;
};

const formatarHora = (value) => {
  if (!value) return "--:--";
  return value;
};

const renderizarProximasHoras = (itens) => {
  proximasHorasList.innerHTML = "";
  if (!Array.isArray(itens) || !itens.length) {
    proximasHorasList.innerHTML = '<div class="loading">Nenhum dado em breve.</div>';
    return;
  }
  itens.forEach((item) => {
    const card = document.createElement("div");
    card.className = "hora-card " + escolherIcone(item.condicao);
    card.innerHTML = `
      <span>${item.hora || "--:--"}</span>
      <strong>${item.temperatura !== null ? `${item.temperatura}°C` : "–"}</strong>
      <span style="font-size:12px;">${item.condicao || "–"}</span>
    `;
    proximasHorasList.appendChild(card);
  });
};

const renderizarPrevisao = (dados) => {
  condicaoElement.textContent = dados.tempo?.condicao || "Sem dados";
  temperaturaElement.textContent = `${dados.tempo?.temperatura ?? "--"}°C`;
  sensacaoElement.textContent = `${dados.tempo?.sensacao ?? "--"}°C`;
  umidadeElement.textContent = `${dados.tempo?.umidade ?? "--"}%`;
  ventoElement.textContent = `${dados.tempo?.vento_kmh ?? "--"} km/h`;
  fonteElement.textContent = dados.fonte || "Não informado";
  dataAtualElement.textContent = formatarData(dados.dataAtual);
  horaAtualElement.textContent = formatarHora(dados.horaAtual);
  const mainIcon = escolherIcone(dados.tempo?.condicao);
  iconeElement.textContent = emojiDoIcone(mainIcon);
  renderizarProximasHoras(dados.proximas_horas);
  renderizarAmanha(dados.amanha);
};

const emojiDoIcone = (icone) => {
  switch (icone) {
    case "icon-sun":
      return "☀️";
    case "icon-rain":
      return "🌧️";
    case "icon-storm":
      return "⛈️";
    case "icon-fog":
      return "🌫️";
    default:
      return "☁️";
  }
};

const renderizarAmanha = (amanha) => {
  if (!tomorrowSection) return;
  if (!amanha) {
    tomorrowSection.innerHTML = '<div class="loading">Previsão para amanhã indisponível.</div>';
    return;
  }
  const iconClass = escolherIcone(amanha.condicao);
  tomorrowSection.innerHTML = `
    <h3>Previsão de Amanhã — ${formatarData(amanha.data)}</h3>
    <div class="tomorrow-icon ${iconClass}">
      ${emojiDoIcone(iconClass)}
    </div>
    <div class="tomorrow-info">
      <p>${amanha.condicao || "–"}</p>
      <p>Min: ${amanha.temperatura_min ?? "--"}°C — Max: ${amanha.temperatura_max ?? "--"}°C</p>
      <p>Umidade média: ${amanha.umidade_media ?? "--"}%</p>
      <p>Vento: ${amanha.vento_medio_kmh ?? "--"} km/h</p>
    </div>
  `;
};

const exibirErro = () => {
  condicaoElement.textContent = "Não foi possível carregar a previsão agora.";
  proximasHorasList.innerHTML =
    '<div class="error">Verifique sua conexão ou tente novamente daqui a pouco.</div>';
  if (tomorrowSection) {
    tomorrowSection.innerHTML =
      '<div class="error">Previsão de amanhã indisponível por enquanto.</div>';
  }
};

const carregarPrevisao = async ({ force = false } = {}) => {
  proximasHorasList.innerHTML = '<div class="loading">Carregando previsão do tempo...</div>';
  try {
    const query = force ? `?force=1&_=${Date.now()}` : `?_=${Date.now()}`;
    const response = await fetch(`/api/previsao${query}`);
    if (!response.ok) throw new Error("Resposta inválida");
    const dados = await response.json();
    renderizarPrevisao(dados);
  } catch (error) {
    console.error("[previsao] falha:", error);
    exibirErro();
  }
};

document.addEventListener("DOMContentLoaded", () => {
  carregarPrevisao({ force: true });
  setInterval(carregarPrevisao, 30 * 60 * 1000);
});
