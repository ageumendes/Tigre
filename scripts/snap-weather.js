const path = require("path");
const { renderWeatherPortrait } = require("../weatherScreenshot");

const mediaDir = path.join(__dirname, "..", "media", "roku");
const destination = path.join(mediaDir, "weather-portrait.jpeg");

(async () => {
  try {
    const result = await renderWeatherPortrait({ baseUrl: "http://localhost:3000", outPath: destination });
    console.log("Screenshot gerado em", destination, result);
  } catch (error) {
    console.error("Falha ao gerar o retrato do tempo:", error.stack || error.message || error);
    process.exitCode = 1;
  }
})();
