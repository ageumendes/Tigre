(() => {
  const host = (window.location.hostname || "").toLowerCase();
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1";

  window.APP_CONFIG = {
    ...(window.APP_CONFIG || {}),
    // local usa absoluto; produção usa relativo (mesma origem)
    apiBase: isLocal ? "http://localhost:3000" : "",
  };
})();