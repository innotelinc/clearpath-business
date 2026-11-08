# ClearPath Business

The business-credit build workspace for **Denovo Credit**, made by **Innotel Labs**.
It is the sibling of [`innotelinc/clearpath`](https://github.com/innotelinc/clearpath),
which handles consumer credit repair and the certified mailroom.

ClearPath Business covers the commercial side: a four-stage build (foundation →
tier 1 vendors → tier 2 retail → tier 3 bank lines), the vendor tradelines that
report to the commercial bureaus, bureau snapshots, the tasks and documents for
each file, an inbound lead inbox, and a read-only client portal.

## Stack

Node.js ≥ 22.5, Express 4, EJS, `node:sqlite` (WAL). No build step, no ORM, no
client-side framework — deliberately the same shape as `clearpath` so the two
services are operated by the same people in the same way.

## Run it

```sh
cp .env.example .env      # then set PLATFORM_ADMIN_PASSWORD
npm install
npm start                 # http://localhost:3100
npm test                  # integration tests (spawns the server on :3911)
npm run check             # syntax check every server module
```

On first boot the app creates the `denovo` tenant, an owner account from
`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`, and — when `SEED_DEMO=1` —
three demonstration businesses plus a demo client login (`Client!2026`) so the
portal can be exercised. Set `SEED_DEMO=0` in production.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/` | public | Landing page with the review form |
| POST | `/intake` | public | Form intake → lead, then Denovo handoff |
| POST | `/api/intake` | public | JSON intake for the marketing site |
| POST | `/api/denovo/leads` | HMAC | Signed lead handoff **into** ClearPath |
| GET | `/healthz` | public | DB-backed liveness probe |
| GET | `/legal/:doc` | public | Privacy, terms |
| GET/POST | `/login` | public | Staff sign-in |
| GET/POST | `/portal/login` | public | Client sign-in |
| POST | `/logout` | session | End the session |
| GET | `/app` | owner, specialist | Pipeline dashboard |
| GET/POST | `/app/businesses` | owner, specialist | List, create |
| GET | `/app/businesses/:id` | owner, specialist | The business file |
| POST | `/app/businesses/:id/{stage,tradelines,bureau,tasks,documents,notes}` | owner, specialist | File updates |
| GET | `/app/leads` | owner, specialist | Lead inbox + handoff log |
| POST | `/app/leads/:id/{status,convert}` | owner, specialist | Triage and convert |
| GET | `/portal` | client | Read-only business file |

## Denovo Credit integration

`denovocredit.com`'s public form posts to its own `/contact` endpoint, which is
CSRF-protected and therefore not callable from another server. Integration is a
two-way signed contract instead of a form post:

**Outbound (this app → Denovo).** Every new lead is POSTed to
`DENOVO_WEBHOOK_URL` as:

```json
{
  "event": "clearpath.business.lead",
  "occurred_at": "2026-11-08T02:41:23.769Z",
  "source": "website",
  "lead": {
    "id": 12,
    "name": "Dana Reed",
    "email": "dana@northline.studio",
    "phone": "(617) 555-0142",
    "business_name": "Northline Studio LLC",
    "interest": "Business credit build",
    "message": "…"
  }
}
```

With `DENOVO_SHARED_SECRET` set, the exact body bytes are signed with
HMAC-SHA256 and sent as `x-clearpath-signature`. Failures never lose the lead:
the inquiry is already stored, and the attempt (including the error) is recorded
in `webhook_deliveries` and shown on **Leads → Denovo handoff**.

**Inbound (Denovo → this app).** Sign the same way and POST to
`/api/denovo/leads`; the handler accepts our field names or Denovo's
`name`/`email`/`phone`/`agency`/`size`/`message` shape. Unsigned or
wrongly-signed requests get `401`, and with no secret configured the endpoint
returns `503` rather than accepting unauthenticated leads.

```sh
BODY='{"name":"Sam Ortiz","email":"sam@brightline.co","business":"Brightline Supply"}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$DENOVO_SHARED_SECRET" -r | cut -d' ' -f1)
curl -X POST http://localhost:3100/api/denovo/leads \
  -H "content-type: application/json" -H "x-clearpath-signature: $SIG" -d "$BODY"
```

## Data model

`tenants → businesses → {tradelines, bureau_reports, documents, tasks, stage_events}`
plus `users` (owner / specialist / client), `sessions`, `leads`,
`webhook_deliveries` and `audit_log`. Every query in the route layer is scoped by
`tenant_id`; a record belonging to another tenant resolves as `404`, and a test
covers exactly that.

## Security posture

- scrypt password hashes, SHA-256 session tokens stored server-side, 14-day expiry
- `HttpOnly` + `SameSite=Lax` cookies, `Secure` when `COOKIE_SECURE=1`
- CSRF token on every state change, plus a same-origin check as defence in depth
- CSP, `X-Frame-Options: DENY`, `nosniff`, no-referrer, payments disabled
- public intake is exempt from CSRF on purpose (no session, no existing record),
  and is instead rate limited per IP and honeypotted
- role separation: staff cannot enter the portal, clients cannot enter `/app`
- `Cache-Control: no-store` on every authenticated render

## Not built here

Billing/subscriptions, document upload bytes, bureau API pulls, email delivery,
SSO, and the certified mailroom all belong to other parts of the stack. The schema
leaves room for them (`documents.url`, plan fields can be added) but nothing is
stubbed to look finished when it is not.

## Deploy

```sh
docker compose up -d --build
```

Mount `/app/data` on persistent storage; the SQLite file and its WAL are the whole
database. Run one instance per database file — SQLite is not a shared server.

## License

AGPL-3.0-only, matching `innotelinc/clearpath`.
