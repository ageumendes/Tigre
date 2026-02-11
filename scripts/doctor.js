const { execFile } = require("child_process");

const check = (bin) =>
  new Promise((resolve) => {
    execFile("which", [bin], (error, stdout) => {
      if (error) return resolve({ bin, ok: false, path: "" });
      resolve({ bin, ok: true, path: (stdout || "").trim() });
    });
  });

(async () => {
  const results = await Promise.all([check("ffmpeg"), check("ffprobe")]);
  results.forEach((res) => {
    if (res.ok) {
      console.log(`[doctor] ${res.bin} ok: ${res.path}`);
    } else {
      console.log(`[doctor] ${res.bin} ausente (instale ffmpeg)`);
    }
  });
})();
