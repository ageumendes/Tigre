module.exports = {
  apps: [
    {
      name: "tv-media",
      script: "server.js",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      env: {
        NODE_ENV: "production",
        PORT: process.env.PORT || "3000",
        MEDIA_DIR: process.env.MEDIA_DIR || "/var/lib/tv-media/media",
        ENABLE_HLS: "true",
      },
    },
  ],
};
