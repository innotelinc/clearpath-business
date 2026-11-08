import { env } from "./env.js";
import { db, nowIso } from "./db.js";
import { hmacHex, verifyHmac } from "./security.js";

/**
 * Denovo Credit integration.
 *
 * denovocredit.com's public form posts to its own CSRF-protected /contact
 * endpoint, so a third-party server cannot submit into it directly. The two
 * supported directions are therefore:
 *
 *  - outbound: every new business-credit lead is POSTed to DENOVO_WEBHOOK_URL,
 *    signed with HMAC-SHA256 over the exact JSON body;
 *  - inbound: denovocredit.com (or the ClearPath workspace) can push a lead
 *    into POST /api/denovo/leads with the same signature.
 *
 * With no webhook configured, leads are still stored and appear in /app/leads;
 * the delivery table records why nothing was sent.
 */

export const denovoUrls = {
  site: env.denovoSite,
  review: env.denovoSite,
  businessCredit: env.denovoSite,
};

export function signPayload(raw) {
  return env.denovoSecret ? hmacHex(env.denovoSecret, raw) : "";
}

export function verifyPayload(raw, header) {
  return verifyHmac(env.denovoSecret, raw, header);
}

export function leadPayload(lead) {
  return JSON.stringify({
    event: "clearpath.business.lead",
    occurred_at: nowIso(),
    source: lead.source,
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      business_name: lead.business_name,
      interest: lead.interest,
      message: lead.message,
    },
  });
}

function recordDelivery(tenantId, leadId, target, status, error = "") {
  db.prepare(
    `INSERT INTO webhook_deliveries (tenant_id, lead_id, target, status, attempts, last_error, created_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)`
  ).run(tenantId, leadId ?? null, target, status, String(error).slice(0, 400), nowIso());
}

/**
 * Push a lead to Denovo. Never throws: a failed handoff must not lose the
 * inquiry, which is already stored locally.
 */
export async function notifyDenovo(lead) {
  if (!env.denovoWebhook) {
    recordDelivery(lead.tenant_id, lead.id, "(not configured)", "skipped", "DENOVO_WEBHOOK_URL is empty");
    return { ok: false, skipped: true };
  }

  const body = leadPayload(lead);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(env.denovoWebhook, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "clearpath-business/1.0",
        ...(env.denovoSecret ? { "x-clearpath-signature": signPayload(body) } : {}),
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      recordDelivery(lead.tenant_id, lead.id, env.denovoWebhook, "failed", `HTTP ${response.status}`);
      return { ok: false, status: response.status };
    }
    recordDelivery(lead.tenant_id, lead.id, env.denovoWebhook, "delivered");
    return { ok: true, status: response.status };
  } catch (error) {
    recordDelivery(lead.tenant_id, lead.id, env.denovoWebhook, "failed", error?.message || "network error");
    return { ok: false, error: error?.message || "network error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Normalize either our own form shape or Denovo's /contact field names. */
export function normalizeLead(body = {}) {
  const pick = (...keys) => {
    for (const key of keys) {
      const value = body[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  };
  return {
    name: pick("name", "full_name", "contact_name").slice(0, 120),
    email: pick("email", "owner_email").toLowerCase().slice(0, 160),
    phone: pick("phone", "owner_phone", "telephone").slice(0, 40),
    businessName: pick("business", "business_name", "company", "agency").slice(0, 160),
    interest: pick("interest", "need", "service", "help").slice(0, 80) || "Business credit build",
    message: pick("message", "notes", "detail", "size").slice(0, 2000),
    source: pick("source").slice(0, 60) || "website",
  };
}
