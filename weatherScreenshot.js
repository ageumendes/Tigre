const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const VIEWPORT = { width: 720, height: 1280 };
const GOTO_OPTIONS = { waitUntil: "networkidle0", timeout: 45000 };
const SELECTOR_OPTIONS = { timeout: 45000 };
const SCREENSHOT_OPTIONS = { type: "jpeg", quality: 80 };

const ensureDirectory = async (targetPath) => {
  await fs.promises.mkdir(targetPath, { recursive: true });
};

const buildPageUrl = (baseUrl) => {
  if (!baseUrl) {
    throw new Error("baseUrl obrigatório para capturar o card do tempo.");
  }
  const sanitizedBase = baseUrl.replace(/\/+$/, "");
  return new URL("previsao.html", `${sanitizedBase}/`).toString();
};

const takeElementOrPageScreenshot = async (page, elementHandle, filePath) => {
  let captured = false;
  if (elementHandle) {
    try {
      await elementHandle.screenshot({ path: filePath, ...SCREENSHOT_OPTIONS });
      captured = true;
    } catch (error) {
      console.warn("Falha ao capturar .weather-card, tentando captura da página", error.message);
    } finally {
      await elementHandle.dispose();
    }
  }

  if (!captured) {
    await page.screenshot({ path: filePath, fullPage: true, ...SCREENSHOT_OPTIONS });
  }
};

const renderWeatherPortrait = async ({ baseUrl, outPath }) => {
  if (!baseUrl) throw new Error("baseUrl inválido para renderizar o retrato do tempo.");
  const targetUrl = buildPageUrl(baseUrl);
  await ensureDirectory(path.dirname(outPath));

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: puppeteer.executablePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(targetUrl, GOTO_OPTIONS);
    await page.waitForSelector("#temperatura-atual", SELECTOR_OPTIONS);
    const elementHandle = await page.$(".weather-card");
    await takeElementOrPageScreenshot(page, elementHandle, outPath);
  } finally {
    await browser.close();
  }

  const stats = await fs.promises.stat(outPath);
  return { ok: true, filename: path.basename(outPath), mtimeMs: stats.mtimeMs };
};

module.exports = { renderWeatherPortrait };
