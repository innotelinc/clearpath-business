import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Minimal .env loader. Node does not read .env files itself, and adding a
// dependency for a dozen keys is not worth it. Existing process.env wins, so a
// real deployment environment is never overwritten by a stale local file.
function load(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const at = line.indexOf("=");
    if (at < 1) continue;
    const key = line.slice(0, at).trim();
    let value = line.slice(at + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export const rootDir = fileURLToPath(new URL("../", import.meta.url));

load(path.join(rootDir, ".env.local"));
load(path.join(rootDir, ".env"));

export const env = {
  port: Number(process.env.PORT || 3100),
  origin: process.env.APP_ORIGIN || "http://localhost:3100",
  dataDir: process.env.DATA_DIR || "./data",
  dbPath: process.env.DB_PATH || "./data/clearpath-business.db",
  cookieSecure: process.env.COOKIE_SECURE === "1",
  adminEmail: process.env.PLATFORM_ADMIN_EMAIL || "admin@denovocredit.com",
  adminPassword: process.env.PLATFORM_ADMIN_PASSWORD || "",
  supportEmail: process.env.SUPPORT_EMAIL || "hello@denovocredit.com",
  supportPhone: process.env.SUPPORT_PHONE || "(774) 505-7135",
  denovoSite: process.env.DENOVO_SITE_URL || "https://denovocredit.com",
  denovoWebhook: process.env.DENOVO_WEBHOOK_URL || "",
  denovoSecret: process.env.DENOVO_SHARED_SECRET || "",
  seedDemo: process.env.SEED_DEMO !== "0",
};
