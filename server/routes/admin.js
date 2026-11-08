import { Router } from "express";
import {
  STAGES,
  audit,
  db,
  nowIso,
  pipeline,
  tenantStats,
} from "../db.js";
import { LEAD_STATUSES } from "../db.js";

const router = Router();

const tenantOf = (req) => req.user.tenant_id;

const toInt = (value, fallback = 0) => {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

function getBusiness(req, id) {
  return db
    .prepare("SELECT * FROM businesses WHERE id = ? AND tenant_id = ?")
    .get(Number(id), tenantOf(req));
}

router.use((req, res, next) => {
  res.locals.active = req.path;
  next();
});

router.get("/", (req, res) => {
  const tenantId = tenantOf(req);
  const stats = tenantStats(tenantId);
  res.render("app/dashboard", {
    title: "Workspace",
    page: "app",
    stats,
    pipelineData: pipeline(tenantId),
    leads: db
      .prepare("SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 6")
      .all(tenantId),
    recent: db
      .prepare("SELECT * FROM stage_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 6")
      .all(tenantId),
  });
});

router.get("/businesses", (req, res) => {
  const tenantId = tenantOf(req);
  const q = String(req.query.q || "").trim().slice(0, 60);
  const rows = q
    ? db
        .prepare(
          "SELECT * FROM businesses WHERE tenant_id = ? AND (name LIKE ? OR owner_name LIKE ?) ORDER BY updated_at DESC"
        )
        .all(tenantId, `%${q}%`, `%${q}%`)
    : db
        .prepare("SELECT * FROM businesses WHERE tenant_id = ? ORDER BY updated_at DESC")
        .all(tenantId);
  res.render("app/businesses", { title: "Businesses", page: "app", businesses: rows, q });
});

router.post("/businesses", (req, res) => {
  const tenantId = tenantOf(req);
  const name = String(req.body.name || "").trim().slice(0, 140);
  if (name.length < 2) {
    return res.redirect(303, "/app/businesses?error=Enter%20the%20business%20name.");
  }
  const created = nowIso();
  const result = db
    .prepare(
      `INSERT INTO businesses (tenant_id, name, entity_type, state, owner_name, owner_email, owner_phone,
        funding_target, monthly_revenue, months_in_business, stage, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', '', ?, ?)`
    )
    .run(
      tenantId,
      name,
      String(req.body.entity_type || "LLC").slice(0, 40),
      String(req.body.state || "").slice(0, 20),
      String(req.body.owner_name || "").slice(0, 120),
      String(req.body.owner_email || "").slice(0, 160),
      String(req.body.owner_phone || "").slice(0, 40),
      toInt(req.body.funding_target),
      toInt(req.body.monthly_revenue),
      toInt(req.body.months_in_business),
      created,
      created
    );
  audit(tenantId, req.user.name, "Business created", name);
  res.redirect(303, `/app/businesses/${Number(result.lastInsertRowid)}`);
});

router.get("/businesses/:id", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const tenantId = tenantOf(req);
  res.render("app/business", {
    title: business.name,
    page: "app",
    business,
    tradelines: db
      .prepare("SELECT * FROM tradelines WHERE tenant_id = ? AND business_id = ? ORDER BY tier, opened_on DESC")
      .all(tenantId, business.id),
    bureaus: db
      .prepare("SELECT * FROM bureau_reports WHERE tenant_id = ? AND business_id = ? ORDER BY pulled_on DESC")
      .all(tenantId, business.id),
    tasks: db
      .prepare("SELECT * FROM tasks WHERE tenant_id = ? AND business_id = ? ORDER BY status, due_on")
      .all(tenantId, business.id),
    documents: db
      .prepare("SELECT * FROM documents WHERE tenant_id = ? AND business_id = ? ORDER BY created_at DESC")
      .all(tenantId, business.id),
    history: db
      .prepare("SELECT * FROM stage_events WHERE tenant_id = ? AND business_id = ? ORDER BY created_at DESC")
      .all(tenantId, business.id),
  });
});

router.post("/businesses/:id/stage", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const to = Math.max(0, Math.min(STAGES.length - 1, toInt(req.body.stage, business.stage)));
  if (to === business.stage) {
    return res.redirect(303, `/app/businesses/${business.id}?error=Already%20at%20that%20stage.`);
  }
  const now = nowIso();
  db.prepare("UPDATE businesses SET stage = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(
    to,
    now,
    business.id,
    tenantOf(req)
  );
  db.prepare(
    `INSERT INTO stage_events (tenant_id, business_id, from_stage, to_stage, note, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantOf(req),
    business.id,
    business.stage,
    to,
    String(req.body.note || "").slice(0, 300),
    req.user.name,
    now
  );
  audit(tenantOf(req), req.user.name, "Stage changed", `${business.name}: ${business.stage} → ${to}`);
  res.redirect(303, `/app/businesses/${business.id}?notice=Stage%20updated.`);
});

router.post("/businesses/:id/tradelines", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const vendor = String(req.body.vendor || "").trim().slice(0, 120);
  if (vendor.length < 2) {
    return res.redirect(303, `/app/businesses/${business.id}?error=Enter%20the%20vendor%20name.`);
  }
  const created = nowIso();
  db.prepare(
    `INSERT INTO tradelines (tenant_id, business_id, vendor, tier, account_type, limit_amount, reports_to, status, opened_on, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantOf(req),
    business.id,
    vendor,
    Math.max(0, Math.min(3, toInt(req.body.tier, 1))),
    String(req.body.account_type || "Net-30").slice(0, 40),
    toInt(req.body.limit_amount),
    String(req.body.reports_to || "D&B, Experian, Equifax").slice(0, 120),
    String(req.body.status || "Open").slice(0, 30),
    String(req.body.opened_on || created.slice(0, 10)).slice(0, 10),
    created
  );
  db.prepare("UPDATE businesses SET updated_at = ? WHERE id = ? AND tenant_id = ?").run(
    created,
    business.id,
    tenantOf(req)
  );
  audit(tenantOf(req), req.user.name, "Tradeline added", `${business.name}: ${vendor}`);
  res.redirect(303, `/app/businesses/${business.id}?notice=Tradeline%20added.`);
});

router.post("/businesses/:id/bureau", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const bureau = String(req.body.bureau || "").trim().slice(0, 60);
  if (bureau.length < 2) {
    return res.redirect(303, `/app/businesses/${business.id}?error=Choose%20a%20bureau.`);
  }
  const created = nowIso();
  db.prepare(
    `INSERT INTO bureau_reports (tenant_id, business_id, bureau, metric, score, pulled_on, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantOf(req),
    business.id,
    bureau,
    String(req.body.metric || "").slice(0, 60),
    Math.max(0, Math.min(100, toInt(req.body.score))),
    String(req.body.pulled_on || created.slice(0, 10)).slice(0, 10),
    String(req.body.notes || "").slice(0, 300),
    created
  );
  audit(tenantOf(req), req.user.name, "Bureau report recorded", `${business.name}: ${bureau}`);
  res.redirect(303, `/app/businesses/${business.id}?notice=Bureau%20report%20saved.`);
});

router.post("/businesses/:id/tasks", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const title = String(req.body.title || "").trim().slice(0, 200);
  if (title.length < 2) {
    return res.redirect(303, `/app/businesses/${business.id}?error=Enter%20a%20task.`);
  }
  db.prepare(
    `INSERT INTO tasks (tenant_id, business_id, title, owner, due_on, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'Open', ?)`
  ).run(
    tenantOf(req),
    business.id,
    title,
    String(req.body.owner || "ClearPath").slice(0, 80),
    String(req.body.due_on || "").slice(0, 10),
    nowIso()
  );
  res.redirect(303, `/app/businesses/${business.id}?notice=Task%20added.`);
});

router.post("/businesses/:id/tasks/:taskId", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  db.prepare("UPDATE tasks SET status = ? WHERE id = ? AND tenant_id = ? AND business_id = ?").run(
    String(req.body.status || "Done").slice(0, 20),
    Number(req.params.taskId),
    tenantOf(req),
    business.id
  );
  res.redirect(303, `/app/businesses/${business.id}?notice=Task%20updated.`);
});

router.post("/businesses/:id/documents", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  const title = String(req.body.title || "").trim().slice(0, 160);
  if (title.length < 2) {
    return res.redirect(303, `/app/businesses/${business.id}?error=Enter%20a%20document%20name.`);
  }
  db.prepare(
    `INSERT INTO documents (tenant_id, business_id, title, kind, status, url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantOf(req),
    business.id,
    title,
    String(req.body.kind || "Other").slice(0, 60),
    String(req.body.status || "Received").slice(0, 30),
    String(req.body.url || "").slice(0, 400),
    nowIso()
  );
  res.redirect(303, `/app/businesses/${business.id}?notice=Document%20logged.`);
});

router.post("/businesses/:id/notes", (req, res, next) => {
  const business = getBusiness(req, req.params.id);
  if (!business) return next();
  db.prepare("UPDATE businesses SET notes = ?, updated_at = ? WHERE id = ? AND tenant_id = ?").run(
    String(req.body.notes || "").slice(0, 2000),
    nowIso(),
    business.id,
    tenantOf(req)
  );
  res.redirect(303, `/app/businesses/${business.id}?notice=Notes%20saved.`);
});

router.get("/leads", (req, res) => {
  const tenantId = tenantOf(req);
  res.render("app/leads", {
    title: "Leads",
    page: "app",
    statuses: LEAD_STATUSES,
    leads: db
      .prepare("SELECT * FROM leads WHERE tenant_id = ? ORDER BY created_at DESC")
      .all(tenantId),
    deliveries: db
      .prepare(
        "SELECT * FROM webhook_deliveries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 8"
      )
      .all(tenantId),
  });
});

router.post("/leads/:id/status", (req, res) => {
  const status = String(req.body.status || "New");
  if (!LEAD_STATUSES.includes(status)) {
    return res.redirect(303, "/app/leads?error=Unknown%20status.");
  }
  db.prepare("UPDATE leads SET status = ? WHERE id = ? AND tenant_id = ?").run(
    status,
    Number(req.params.id),
    tenantOf(req)
  );
  audit(tenantOf(req), req.user.name, "Lead status", `${req.params.id} → ${status}`);
  res.redirect(303, "/app/leads?notice=Lead%20updated.");
});

router.post("/leads/:id/convert", (req, res) => {
  const tenantId = tenantOf(req);
  const lead = db
    .prepare("SELECT * FROM leads WHERE id = ? AND tenant_id = ?")
    .get(Number(req.params.id), tenantId);
  if (!lead) return res.redirect(303, "/app/leads?error=Lead%20not%20found.");

  const created = nowIso();
  const result = db
    .prepare(
      `INSERT INTO businesses (tenant_id, name, entity_type, state, owner_name, owner_email, owner_phone,
        funding_target, monthly_revenue, months_in_business, stage, status, notes, created_at, updated_at)
       VALUES (?, ?, 'LLC', '', ?, ?, ?, 0, 0, 0, 0, 'active', ?, ?, ?)`
    )
    .run(
      tenantId,
      lead.business_name || `${lead.name} (business)`,
      lead.name,
      lead.email,
      lead.phone,
      `Converted from lead #${lead.id}. ${lead.message}`.slice(0, 2000),
      created,
      created
    );
  db.prepare("UPDATE leads SET status = 'Won' WHERE id = ? AND tenant_id = ?").run(lead.id, tenantId);
  audit(tenantId, req.user.name, "Lead converted", `${lead.name} → business #${Number(result.lastInsertRowid)}`);
  res.redirect(303, `/app/businesses/${Number(result.lastInsertRowid)}?notice=Lead%20converted%20to%20a%20business.`);
});

export default router;
