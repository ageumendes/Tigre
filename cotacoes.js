const cotacoesList = document.getElementById("cotacoes-list");
const fonteLabel = document.getElementById("fonte-cotacoes");
const atualizacaoInfo = document.getElementById("atualizacao-info");
const horaAtual = document.getElementById("hora-atual");
const dataAtual = document.getElementById("data-atual");

const formatadorBRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const formatarPreco = (valor) => {
  if (valor === null || valor === undefined) return "–";
  return formatadorBRL.format(valor);
};

const atualizarHorarioEmLoop = () => {
  const agora = new Date();
  const horas = agora.toLocaleTimeString("pt-BR");
  const data = agora.toLocaleDateString("pt-BR");
  if (horaAtual) horaAtual.textContent = horas;
  if (dataAtual) dataAtual.textContent = data;
  setTimeout(atualizarHorarioEmLoop, 1000);
};

const exibirMensagem = (mensagem, tipo = "") => {
  cotacoesList.innerHTML = `<div class="message ${tipo}">${mensagem}</div>`;
};

const renderizarCotacoes = (dados) => {
  fonteLabel.textContent = `Fonte: ${dados.fontePrincipal || "–"}`;
  atualizacaoInfo.textContent = `Cotações de ${dados.dataAtual || "–"}`;
  cotacoesList.innerHTML = "";

  if (!Array.isArray(dados.itens) || !dados.itens.length) {
    exibirMensagem("Nenhum registro disponível no momento.", "error");
    return;
  }

  dados.itens.forEach((item) => {
    const elemento = document.createElement("div");
    elemento.className = "cotacao-item";

    const superior = document.createElement("div");
    superior.className = "cotacao-linha-superior";

    const textos = document.createElement("div");
    textos.className = "prod-texts";
    textos.innerHTML = `
      <span class="prod-nome">${item.nome}</span>
      <span class="prod-unidade">${item.unidade || ""}</span>
      <span class="prod-ref">Referência: ${item.regiaoReferencia || "–"}</span>
    `;

    const precoEl = document.createElement("div");
    precoEl.className = "cotacao-preco";
    precoEl.textContent =
      item.preco !== null && item.preco !== undefined ? formatarPreco(item.preco) : "-";

    superior.appendChild(textos);
    superior.appendChild(precoEl);

    elemento.appendChild(superior);

    if (item.obs) {
      const obsEl = document.createElement("div");
      obsEl.className = "cotacao-obs";
      obsEl.textContent = item.obs;
      elemento.appendChild(obsEl);
    }

    cotacoesList.appendChild(elemento);
  });
};

const carregarCotacoes = async () => {
  exibirMensagem("Carregando cotações...");
  try {
    const response = await fetch("/api/cotacoes-agro");
    if (!response.ok) {
      throw new Error("Resposta não ok");
    }
    const dados = await response.json();
    renderizarCotacoes(dados);
  } catch (error) {
    console.error("[cotacoes] falha ao carregar:", error);
    exibirMensagem("Não foi possível carregar as cotações agora.", "error");
    atualizacaoInfo.textContent = "Tente novamente em alguns minutos.";
  }
};

document.addEventListener("DOMContentLoaded", () => {
  atualizarHorarioEmLoop();
  carregarCotacoes();
  setInterval(carregarCotacoes, 10 * 60 * 1000);
});
