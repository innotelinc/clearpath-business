import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "clearpath-business-"));
const dbPath = path.join(dir, "test.db");
const secret = "test-secret-value";
const port = 3911;
const base = `http://127.0.0.1:${port}`;

let child;
let staffJar = "";

const digest = (raw) => createHmac("sha256", secret).update(raw).digest("hex");

function withCookies(jar, response) {
  const map = new Map();
  for (const pair of jar ? jar.split("; ") : []) {
    const at = pair.indexOf("=");
    if (at > 0) map.set(pair.slice(0, at), pair.slice(at + 1));
  }
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0];
    const at = pair.indexOf("=");
    if (at > 0) map.set(pair.slice(0, at), pair.slice(at + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

const cookieValue = (jar, name) => {
  const hit = jar.split("; ").find((pair) => pair.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : "";
};

async function waitForHealth() {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("server did not become healthy");
}

function openDb() {
  return new DatabaseSync(dbPath);
}

before(async () => {
  child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "server/index.js"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      APP_ORIGIN: base,
      COOKIE_SECURE: "0",
      PLATFORM_ADMIN_EMAIL: "admin@test.local",
      PLATFORM_ADMIN_PASSWORD: "Test!2026",
      DENOVO_SHARED_SECRET: secret,
      DENOVO_WEBHOOK_URL: "",
      SEED_DEMO: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForHealth();
});

after(async () => {
  if (child && !child.killed) {
    child.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 4000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  try {
    // Windows keeps the SQLite file locked for a moment after exit.
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* temp-dir cleanup is best effort */
  }
});

test("health check responds", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "clearpath-business");
});

test("landing page renders the intake form", async () => {
  const res = await fetch(base);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Request your free first review/);
  assert.match(html, /Denovo Credit/);
});

test("intake stores a lead", async () => {
  const res = await fetch(`${base}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Nadia Cole",
      email: "nadia@ferrous.co",
      phone: "6175550111",
      business: "Ferrous Works LLC",
      interest: "Business credit build",
      message: "Formed last year, no tradelines yet.",
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.ok(body.lead_id > 0);

  const db = openDb();
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(body.lead_id);
  db.close();
  assert.equal(lead.email, "nadia@ferrous.co");
  assert.equal(lead.business_name, "Ferrous Works LLC");
  assert.equal(lead.status, "New");
});

test("intake rejects an invalid email", async () => {
  const res = await fetch(`${base}/api/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Bad Row", email: "nope", business: "Bad Row LLC" }),
  });
  assert.equal(res.status, 400);
});

test("denovo handoff rejects an unsigned request", async () => {
  const res = await fetch(`${base}/api/denovo/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "X", email: "x@y.co" }),
  });
  assert.equal(res.status, 401);
});

test("denovo handoff accepts a signed lead", async () => {
  const raw = JSON.stringify({
    name: "Sam Ortiz",
    email: "sam@brightline.co",
    phone: "4135550188",
    business: "Brightline Supply",
    interest: "Both programs",
    message: "Asked about business credit on the Denovo site.",
    source: "denovocredit.com",
  });
  const res = await fetch(`${base}/api/denovo/leads`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-clearpath-signature": digest(raw) },
    body: raw,
  });
  assert.equal(res.status, 201);
  const body = await res.json();

  const db = openDb();
  const lead = db.prepare("SELECT * FROM leads WHERE id = ?").get(body.lead_id);
  db.close();
  assert.equal(lead.email, "sam@brightline.co");
  assert.equal(lead.source, "denovocredit.com");
});

test("staff sign-in sets a session", async () => {
  const page = await fetch(`${base}/login`);
  staffJar = withCookies("", page);

  const res = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: staffJar,
    },
    body: new URLSearchParams({
      email: "admin@test.local",
      password: "Test!2026",
      _csrf: cookieValue(staffJar, "cp_csrf"),
      next: "/app",
    }),
  });
  assert.equal(res.status, 303);
  staffJar = withCookies(staffJar, res);
  assert.ok(cookieValue(staffJar, "cp_session"));

  const dashboard = await fetch(`${base}/app`, { headers: { cookie: staffJar } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Businesses/);
});

test("wrong password is refused", async () => {
  const page = await fetch(`${base}/login`);
  const jar = withCookies("", page);
  const res = await fetch(`${base}/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({
      email: "admin@test.local",
      password: "wrong-password",
      _csrf: cookieValue(jar, "cp_csrf"),
    }),
  });
  assert.equal(res.status, 401);
  assert.equal(cookieValue(withCookies(jar, res), "cp_session"), "");
});

test("admin writes require a CSRF token", async () => {
  const db = openDb();
  const business = db
    .prepare("SELECT id FROM businesses WHERE name = 'Northline Studio LLC'")
    .get();
  db.close();

  const res = await fetch(`${base}/app/businesses/${business.id}/stage`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: staffJar },
    body: new URLSearchParams({ stage: "2" }),
  });
  assert.equal(res.status, 403);
});

test("advancing the stage records the move", async () => {
  const db = openDb();
  const business = db
    .prepare("SELECT * FROM businesses WHERE name = 'Northline Studio LLC'")
    .get();
  db.close();

  const res = await fetch(`${base}/app/businesses/${business.id}/stage`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: staffJar },
    body: new URLSearchParams({
      stage: "2",
      note: "Two revolving accounts opened",
      _csrf: cookieValue(staffJar, "cp_csrf"),
    }),
  });
  assert.equal(res.status, 303);

  const after = openDb();
  const updated = after.prepare("SELECT stage FROM businesses WHERE id = ?").get(business.id);
  const events = after
    .prepare("SELECT COUNT(*) AS n FROM stage_events WHERE business_id = ?")
    .get(business.id);
  after.close();
  assert.equal(updated.stage, 2);
  assert.ok(events.n >= 1);
});

test("a client session is confined to the portal", async () => {
  const page = await fetch(`${base}/portal/login`);
  const jar = withCookies("", page);
  const res = await fetch(`${base}/portal/login`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: jar },
    body: new URLSearchParams({
      email: "dana@northline.studio",
      password: "Client!2026",
      _csrf: cookieValue(jar, "cp_csrf"),
      next: "/portal",
    }),
  });
  assert.equal(res.status, 303);
  const clientJar = withCookies(jar, res);
  assert.ok(cookieValue(clientJar, "cp_session"));

  const portal = await fetch(`${base}/portal`, { headers: { cookie: clientJar } });
  assert.equal(portal.status, 200);
  assert.match(await portal.text(), /Northline Studio LLC/);

  const blocked = await fetch(`${base}/app`, { redirect: "manual", headers: { cookie: clientJar } });
  assert.equal(blocked.status, 302);
  assert.equal(blocked.headers.get("location"), "/portal");
});

test("another tenant's business is not reachable", async () => {
  const db = openDb();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO tenants (slug, name, brand_name, domain, support_email, support_phone, accent, created_at)
     VALUES ('other', 'Other Credit', 'Other Credit', 'other.example', 'hi@other.example', '555', '#fff', ?)`
  ).run(now);
  const tenantId = db.prepare("SELECT id FROM tenants WHERE slug = 'other'").get().id;
  db.prepare(
    `INSERT INTO businesses (tenant_id, name, entity_type, state, ein, duns, naics, stage, funding_target,
      monthly_revenue, months_in_business, owner_name, owner_email, owner_phone, status, notes, created_at, updated_at)
     VALUES (?, 'Hidden Co', 'LLC', 'MA', '', '', '', 0, 0, 0, 0, '', '', '', 'active', '', ?, ?)`
  ).run(tenantId, now, now);
  const hiddenId = db.prepare("SELECT id FROM businesses WHERE name = 'Hidden Co'").get().id;
  db.close();

  const res = await fetch(`${base}/app/businesses/${hiddenId}`, {
    headers: { cookie: staffJar },
  });
  assert.equal(res.status, 404);
});
