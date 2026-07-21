const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const readJsonFile = (filePath, fallback) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
};

const createStorage = ({ dbPath, legacyFiles = {} }) => {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_documents (
      key TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS stats_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      type TEXT NOT NULL,
      client_mac TEXT,
      client_ip TEXT,
      ssid TEXT,
      user_agent TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_stats_events_timestamp ON stats_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_stats_events_type ON stats_events(type);
    CREATE TABLE IF NOT EXISTS storage_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const getDocumentRow = db.prepare("SELECT json FROM app_documents WHERE key = ?");
  const putDocument = db.prepare(`
    INSERT INTO app_documents (key, json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
  `);
  const getMeta = db.prepare("SELECT value FROM storage_meta WHERE key = ?");
  const putMeta = db.prepare(`
    INSERT INTO storage_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const backupDir = path.join(path.dirname(dbPath), "json-migration-backup");
  const backupLegacyFile = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) return;
    fs.mkdirSync(backupDir, { recursive: true });
    const destination = path.join(backupDir, path.basename(filePath));
    if (!fs.existsSync(destination)) fs.copyFileSync(filePath, destination);
  };

  const migrate = db.transaction(() => {
    const documentDefaults = {
      media_config: { targets: {} },
      tv_config: [],
      promos: [],
      transcode_queue: [],
    };
    Object.entries(documentDefaults).forEach(([key, fallback]) => {
      if (getDocumentRow.get(key)) return;
      const legacyPath = legacyFiles[key];
      backupLegacyFile(legacyPath);
      putDocument.run(key, JSON.stringify(readJsonFile(legacyPath, fallback)), Date.now());
    });

    const statsMigrated = getMeta.get("stats_migrated");
    if (!statsMigrated) {
      const legacyStats = readJsonFile(legacyFiles.stats, []);
      backupLegacyFile(legacyFiles.stats);
      const insert = db.prepare(`
        INSERT INTO stats_events (timestamp, type, client_mac, client_ip, ssid, user_agent)
        VALUES (@timestamp, @type, @clientMac, @clientIp, @ssid, @userAgent)
      `);
      (Array.isArray(legacyStats) ? legacyStats : []).forEach((event) => insert.run({
        timestamp: Number(event?.timestamp) || Date.now(),
        type: `${event?.type || "unknown"}`,
        clientMac: event?.clientMac || "",
        clientIp: event?.clientIp || "",
        ssid: event?.ssid || "",
        userAgent: event?.userAgent || "",
      }));
      putMeta.run("stats_migrated", new Date().toISOString());
    }
    putMeta.run("schema_version", "1");
  });
  migrate();

  const insertStat = db.prepare(`
    INSERT INTO stats_events (timestamp, type, client_mac, client_ip, ssid, user_agent)
    VALUES (@timestamp, @type, @clientMac, @clientIp, @ssid, @userAgent)
  `);
  const insertStatsTransaction = db.transaction((events) => {
    events.forEach((event) => insertStat.run({
      timestamp: Number(event?.timestamp) || Date.now(),
      type: `${event?.type || "unknown"}`,
      clientMac: event?.clientMac || "",
      clientIp: event?.clientIp || "",
      ssid: event?.ssid || "",
      userAgent: event?.userAgent || "",
    }));
  });

  return {
    dbPath,
    readDocument(key, fallback) {
      const row = getDocumentRow.get(key);
      if (!row) return fallback;
      try { return JSON.parse(row.json); } catch (_error) { return fallback; }
    },
    writeDocument(key, value) {
      putDocument.run(key, JSON.stringify(value), Date.now());
      return value;
    },
    readStats(limit = 5000) {
      return db.prepare(`
        SELECT timestamp, type, client_mac AS clientMac, client_ip AS clientIp,
               ssid, user_agent AS userAgent
        FROM stats_events ORDER BY id DESC LIMIT ?
      `).all(limit).reverse();
    },
    appendStats(events) {
      if (Array.isArray(events) && events.length) insertStatsTransaction(events);
    },
    trimStats(limit = 5000) {
      db.prepare(`DELETE FROM stats_events WHERE id NOT IN (SELECT id FROM stats_events ORDER BY id DESC LIMIT ?)`).run(limit);
    },
    health() {
      const row = db.prepare("PRAGMA quick_check").get();
      return { ok: row?.quick_check === "ok", path: dbPath };
    },
    close() {
      db.close();
    },
  };
};

module.exports = { createStorage };
