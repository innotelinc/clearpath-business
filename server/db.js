import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { env } from "./env.js";
import { hashPassword } from "./security.js";

mkdirSync(path.dirname(path.resolve(env.dbPath)), { recursive: true });

export const db = new DatabaseSync(env.dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  brand_name TEXT NOT NULL,
  domain TEXT NOT NULL,
  support_email TEXT NOT NULL,
  support_phone TEXT NOT NULL,
  accent TEXT NOT NULL DEFAULT '#2fd6a3',
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT 'LLC',
  state TEXT NOT NULL DEFAULT '',
  ein TEXT NOT NULL DEFAULT '',
  duns TEXT NOT NULL DEFAULT '',
  naics TEXT NOT NULL DEFAULT '',
  stage INTEGER NOT NULL DEFAULT 0,
  funding_target INTEGER NOT NULL DEFAULT 0,
  monthly_revenue INTEGER NOT NULL DEFAULT 0,
  months_in_business INTEGER NOT NULL DEFAULT 0,
  owner_name TEXT NOT NULL DEFAULT '',
  owner_email TEXT NOT NULL DEFAULT '',
  owner_phone TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'specialist', 'client')),
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS users_tenant_email ON users (tenant_id, lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_stage INTEGER NOT NULL,
  to_stage INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tradelines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  vendor TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1,
  account_type TEXT NOT NULL DEFAULT 'Net-30',
  limit_amount INTEGER NOT NULL DEFAULT 0,
  reports_to TEXT NOT NULL DEFAULT 'D&B, Experian, Equifax',
  status TEXT NOT NULL DEFAULT 'Open',
  opened_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bureau_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  bureau TEXT NOT NULL,
  metric TEXT NOT NULL DEFAULT '',
  score INTEGER NOT NULL DEFAULT 0,
  pulled_on TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Other',
  status TEXT NOT NULL DEFAULT 'Received',
  url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  owner TEXT NOT NULL DEFAULT 'ClearPath',
  due_on TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Open',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  business_name TEXT NOT NULL DEFAULT '',
  interest TEXT NOT NULL DEFAULT 'Business credit build',
  message TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'New',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id INTEGER REFERENCES leads(id) ON DELETE CASCADE,
  target TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 1,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
  actor TEXT NOT NULL DEFAULT 'System',
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);

export const STAGES = [
  { key: 0, tier: "Stage 0", name: "Foundation", window: "Days 1–30" },
  { key: 1, tier: "Tier 1", name: "Starter vendor accounts", window: "Days 30–60" },
  { key: 2, tier: "Tier 2", name: "Retail and revolving", window: "Days 60–120" },
  { key: 3, tier: "Tier 3", name: "Bank and cash lines", window: "Months 5–9" },
];

export const LEAD_STATUSES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"];

export const nowIso = () => new Date().toISOString();

export function audit(tenantId, actor, action, detail = "") {
  db.prepare(
    "INSERT INTO audit_log (tenant_id, actor, action, detail, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(tenantId ?? null, String(actor || "System").slice(0, 120), String(action).slice(0, 160), String(detail).slice(0, 500), nowIso());
}

export const getTenantById = (id) =>
  db.prepare("SELECT * FROM tenants WHERE id = ?").get(id) || null;

export function defaultTenant() {
  return db.prepare("SELECT * FROM tenants ORDER BY id LIMIT 1").get() || null;
}

export function tenantForHost(host = "") {
  const clean = String(host || "").split(":")[0].toLowerCase();
  if (!clean) return null;
  const exact = db.prepare("SELECT * FROM tenants WHERE lower(domain) = ?").get(clean);
  if (exact) return exact;
  const sub = clean.split(".")[0];
  const bySlug = db.prepare("SELECT * FROM tenants WHERE slug = ?").get(sub);
  return bySlug || null;
}

export function tenantStats(tenantId) {
  const one = (sql, ...args) => db.prepare(sql).get(tenantId, ...args)?.n ?? 0;
  return {
    businesses: one("SELECT COUNT(*) AS n FROM businesses WHERE tenant_id = ?"),
    active: one("SELECT COUNT(*) AS n FROM businesses WHERE tenant_id = ? AND status = 'active'"),
    tradelines: one("SELECT COUNT(*) AS n FROM tradelines WHERE tenant_id = ?"),
    leads: one("SELECT COUNT(*) AS n FROM leads WHERE tenant_id = ? AND status = 'New'"),
    tasks: one("SELECT COUNT(*) AS n FROM tasks WHERE tenant_id = ? AND status = 'Open'"),
  };
}

export function pipeline(tenantId) {
  return STAGES.map((stage) => ({
    ...stage,
    businesses: db
      .prepare("SELECT * FROM businesses WHERE tenant_id = ? AND stage = ? ORDER BY updated_at DESC")
      .all(tenantId, stage.key),
  }));
}

export function ensureBootstrap() {
  let tenant = defaultTenant();
  if (!tenant) {
    db.prepare(
      `INSERT INTO tenants (slug, name, brand_name, domain, support_email, support_phone, accent, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      "denovo",
      "Denovo Credit Corporation",
      "ClearPath Business",
      "denovocredit.com",
      env.supportEmail,
      env.supportPhone,
      "#2fd6a3",
      nowIso()
    );
    tenant = defaultTenant();
    audit(tenant.id, "System", "Workspace created", "Denovo Credit Corporation");
  }

  const email = env.adminEmail;
  const existing = db
    .prepare("SELECT * FROM users WHERE tenant_id = ? AND lower(email) = lower(?) AND role = 'owner'")
    .get(tenant.id, email);
  if (existing) return { tenant, created: false };

  const password = env.adminPassword || "Platform!2026";
  const { salt, hash } = hashPassword(password);
  db.prepare(
    `INSERT INTO users (tenant_id, business_id, email, name, role, password_salt, password_hash, must_change_password, created_at)
     VALUES (?, NULL, ?, ?, 'owner', ?, ?, 0, ?)`
  ).run(tenant.id, email, "Workspace owner", salt, hash, nowIso());
  audit(tenant.id, "System", "Owner account created", email);
  return { tenant, created: true, demoPassword: env.adminPassword ? null : password };
}

const DEMO = [
  {
    name: "Northline Studio LLC",
    stage: 1,
    state: "MA",
    duns: "08-123-4567",
    funding: 45000,
    revenue: 18000,
    months: 14,
    owner: "Dana Reed",
    email: "dana@northline.studio",
    phone: "(617) 555-0142",
    tradelines: [
      ["Uline", 1, "Net-30", 250, "Open"],
      ["Grainger", 1, "Net-30", 500, "Open"],
      ["Staples Business", 2, "Revolving", 1500, "Open"],
    ],
    bureaus: [["D&B", "PAYDEX", 80], ["Experian", "Intelliscore", 68], ["Equifax", "Payment Index", 82]],
    tasks: ["Confirm 411 phone listing", "Pull first PAYDEX report"],
  },
  {
    name: "Harbor & Pine Coffee Co.",
    stage: 0,
    state: "MA",
    duns: "",
    funding: 25000,
    revenue: 4200,
    months: 3,
    owner: "Marco Silva",
    email: "marco@harborpine.coffee",
    phone: "(774) 555-0199",
    tradelines: [],
    bureaus: [],
    tasks: ["File articles of organization", "Open business bank account", "Request DUNS number"],
  },
  {
    name: "Fenwick Logistics Inc.",
    stage: 3,
    state: "RI",
    duns: "09-884-2210",
    funding: 150000,
    revenue: 96000,
    months: 41,
    owner: "Alexis Boone",
    email: "alexis@fenwicklogistics.com",
    phone: "(401) 555-0110",
    tradelines: [
      ["Uline", 1, "Net-30", 750, "Open"],
      ["Home Depot Commercial", 2, "Revolving", 5000, "Open"],
      ["Shell Business", 2, "Fuel", 2500, "Open"],
      ["Bank line of credit", 3, "Line of credit", 40000, "Open"],
    ],
    bureaus: [["D&B", "PAYDEX", 82], ["Experian", "Intelliscore", 74], ["Equifax", "Payment Index", 86]],
    tasks: ["Assemble lender package", "Review term loan options"],
  },
];

export function seedDemo() {
  const tenant = defaultTenant();
  if (!tenant) return 0;
  const count = db.prepare("SELECT COUNT(*) AS n FROM businesses WHERE tenant_id = ?").get(tenant.id).n;
  if (count > 0) return 0;

  const insertBusiness = db.prepare(
    `INSERT INTO businesses (tenant_id, name, entity_type, state, ein, duns, naics, stage, funding_target,
      monthly_revenue, months_in_business, owner_name, owner_email, owner_phone, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`
  );
  const insertTradeline = db.prepare(
    `INSERT INTO tradelines (tenant_id, business_id, vendor, tier, account_type, limit_amount, reports_to, status, opened_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'D&B, Experian, Equifax', ?, ?, ?)`
  );
  const insertBureau = db.prepare(
    `INSERT INTO bureau_reports (tenant_id, business_id, bureau, metric, score, pulled_on, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, '', ?)`
  );
  const insertTask = db.prepare(
    `INSERT INTO tasks (tenant_id, business_id, title, owner, due_on, status, created_at)
     VALUES (?, ?, ?, 'ClearPath', ?, 'Open', ?)`
  );

  let made = 0;
  for (const demo of DEMO) {
    const created = nowIso();
    const result = insertBusiness.run(
      tenant.id,
      demo.name,
      demo.name.includes("Inc.") ? "C-Corp" : "LLC",
      demo.state,
      "",
      demo.duns,
      "541600",
      demo.stage,
      demo.funding,
      demo.revenue,
      demo.months,
      demo.owner,
      demo.email,
      demo.phone,
      "Demonstration record",
      created,
      created
    );
    const id = Number(result.lastInsertRowid);
    for (const [vendor, tier, type, limit, status] of demo.tradelines) {
      insertTradeline.run(tenant.id, id, vendor, tier, type, limit, status, created.slice(0, 10), created);
    }
    for (const [bureau, metric, score] of demo.bureaus) {
      insertBureau.run(tenant.id, id, bureau, metric, score, created.slice(0, 10), created);
    }
    demo.tasks.forEach((title, i) => {
      const due = new Date(Date.now() + (i + 1) * 7 * 86400000).toISOString().slice(0, 10);
      insertTask.run(tenant.id, id, title, due, created);
    });
    // A portal login for the demo client, so the client view is testable.
    const { salt, hash } = hashPassword("Client!2026");
    db.prepare(
      `INSERT INTO users (tenant_id, business_id, email, name, role, password_salt, password_hash, must_change_password, created_at)
       VALUES (?, ?, ?, ?, 'client', ?, ?, 0, ?)`
    ).run(tenant.id, id, demo.email, demo.owner, salt, hash, created);
    made += 1;
  }

  const sampleLeads = [
    ["Terrence Boyd", "terrence@boydmech.com", "(413) 555-0121", "Boyd Mechanical", "Business credit build", "Formed in 2023, needs funding for equipment."],
    ["Priya Raman", "priya@lotusgoods.co", "", "Lotus Goods Co.", "Both programs", "Owner score around 640, wants both files handled."],
  ];
  for (const [name, email, phone, businessName, interest, message] of sampleLeads) {
    db.prepare(
      `INSERT INTO leads (tenant_id, name, email, phone, business_name, interest, message, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'website', 'New', ?)`
    ).run(tenant.id, name, email, phone, businessName, interest, message, nowIso());
  }

  audit(tenant.id, "System", "Seeded demonstration data", `${made} businesses`);
  return made;
}
