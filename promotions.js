const API_BASE = (window.APP_CONFIG?.apiBase || "").replace(/\/$/, "");
const promosArea = document.getElementById("promos-area");
const promosStatus = document.getElementById("promos-status");
const reloadPromosBtn = document.getElementById("reload-promos");

const buildUrl = (path) => `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;

const setStatus = (message, isError = false) => {
  if (!promosStatus) return;
  promosStatus.textContent = message || "";
  promosStatus.classList.toggle("error", !!isError);
};

const formatDate = (value) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR");
};

const renderPromos = (promos) => {
  if (!promosArea) return;
  promosArea.innerHTML = "";
  if (!promos?.length) {
    promosArea.innerHTML = `
      <div class="placeholder">
        <p>Nenhuma promoção ativa no momento.</p>
        <small>Volte em instantes para novas ofertas.</small>
      </div>`;
    return;
  }

  promos.forEach((promo) => {
    const card = document.createElement("article");
    card.className = "promo-item";
    card.innerHTML = `
      <div class="promo-header">
        <div>
          <p class="promo-badge">${promo.badge || "Oferta"}</p>
          <h3 class="promo-title">${promo.title || "Promoção"}</h3>
        </div>
        ${promo.price ? `<div class="promo-price">${promo.price}</div>` : ""}
      </div>
      <p class="promo-description">${promo.description || ""}</p>
      <div class="promo-footer">
        ${promo.validUntil ? `<span class="muted">Válido até ${formatDate(promo.validUntil)}</span>` : "<span class=\"muted\">Válido enquanto durar o estoque.</span>"}
      </div>
    `;
    if (promo.imageUrl) {
      const img = document.createElement("img");
      img.src = promo.imageUrl;
      img.alt = promo.title || "Promoção";
      img.className = "promo-image";
      card.appendChild(img);
    }
    promosArea.appendChild(card);
  });
};

const loadPromos = async () => {
  setStatus("Carregando promoções...");
  try {
    const response = await fetch(buildUrl(`/api/promos?active=true&t=${Date.now()}`), { cache: "no-store" });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) throw new Error(data?.message || "Erro ao carregar promoções.");
    renderPromos(data.promos || []);
    setStatus(`Promoções ativas: ${data.promos?.length || 0}`);
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Não foi possível carregar promoções.", true);
  }
};

const init = () => {
  loadPromos();
  if (reloadPromosBtn) reloadPromosBtn.addEventListener("click", loadPromos);
};

window.addEventListener("DOMContentLoaded", init);
