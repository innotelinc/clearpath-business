import { Router } from "express";
import { defaultTenant, db, audit, nowIso, tenantForHost } from "../db.js";
import { notifyDenovo, normalizeLead } from "../denovo.js";
import { throttle } from "../auth.js";

const router = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function createLead(tenantId, data) {
  const result = db
    .prepare(
      `INSERT INTO leads (tenant_id, name, email, phone, business_name, interest, message, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', ?)`
    )
    .run(
      tenantId,
      data.name,
      data.email,
      data.phone || "",
      data.businessName || "",
      data.interest || "Business credit build",
      data.message || "",
      data.source || "website",
      nowIso()
    );
  return db.prepare("SELECT * FROM leads WHERE id = ?").get(Number(result.lastInsertRowid));
}

async function handleIntake(req, res, { json }) {
  const tenant = tenantForHost(req.headers.host) || defaultTenant();
  if (!tenant) {
    return json
      ? res.status(503).json({ error: "Workspace is not configured." })
      : res.redirect(303, "/?sent=0#intake");
  }

  const ip = req.ip || "unknown";
  if (throttle(`intake:${ip}:${tenant.id}`, { max: 8, windowMs: 60 * 60 * 1000 })) {
    return json
      ? res.status(429).json({ error: "Too many requests. Call us instead." })
      : res.redirect(303, "/?sent=0&error=Too%20many%20requests.%20Call%20us%20instead.#intake");
  }

  const body = req.body || {};
  // Hidden field: humans never fill it.
  if (body.company_website) {
    return json ? res.status(204).end() : res.redirect(303, "/?sent=1#intake");
  }

  const data = normalizeLead(body);
  const fail = (message) =>
    json
      ? res.status(400).json({ error: message })
      : res.redirect(303, `/?sent=0&error=${encodeURIComponent(message)}#intake`);

  if (data.name.length < 2) return fail("Tell us who we are speaking with.");
  if (!EMAIL.test(data.email)) return fail("Enter a valid email address.");
  if (data.businessName.length < 2) return fail("Add the business name, or say it is not formed yet.");
  if (data.message.length > 2000) return fail("Keep the message under 2000 characters.");

  const lead = createLead(tenant.id, data);
  audit(tenant.id, "Website", "Business credit request", `${lead.name} · ${lead.business_name || "no business name"}`);
  await notifyDenovo(lead);

  if (json) return res.status(201).json({ ok: true, lead_id: lead.id });
  return res.redirect(303, "/?sent=1#intake");
}

router.post("/intake", (req, res) => handleIntake(req, res, { json: false }));
router.post("/api/intake", (req, res) => handleIntake(req, res, { json: true }));

export default router;
