import { Router } from "express";
import { defaultTenant, audit } from "../db.js";
import { normalizeLead, notifyDenovo, verifyPayload } from "../denovo.js";
import { env } from "../env.js";
import { createLead } from "./intake.js";

const router = Router();

/**
 * Inbound lead handoff. denovocredit.com's own /contact form is CSRF-bound to
 * its own deployment, so the supported contract is this signed endpoint: the
 * caller signs the exact JSON body with DENOVO_SHARED_SECRET and sends it as
 * x-clearpath-signature.
 */
router.post("/leads", async (req, res) => {
  if (!env.denovoSecret) {
    return res.status(503).json({ error: "Lead handoff is not configured (DENOVO_SHARED_SECRET is empty)." });
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || "");
  const signature = req.headers["x-clearpath-signature"] || req.headers["x-denovo-signature"];
  if (!verifyPayload(raw, signature)) {
    return res.status(401).json({ error: "Invalid signature." });
  }

  let body;
  try {
    body = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    return res.status(400).json({ error: "Body must be valid JSON." });
  }

  const tenant = defaultTenant();
  if (!tenant) return res.status(503).json({ error: "Workspace is not configured." });

  const data = normalizeLead(body.lead || body);
  if (data.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    return res.status(400).json({ error: "A name and a valid email are required." });
  }

  const lead = createLead(tenant.id, { ...data, source: data.source || "denovocredit.com" });
  audit(tenant.id, "Denovo Credit", "Lead received", `${lead.name} · ${lead.business_name || "no business name"}`);
  await notifyDenovo(lead);
  return res.status(201).json({ ok: true, lead_id: lead.id });
});

export default router;
