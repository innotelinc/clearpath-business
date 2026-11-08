# ClearPath Business in the Innotel Platform Stack

**Role: ClientOps (business credit)** — the business-credit build workspace behind
Denovo Credit, and the sibling of `innotelinc/clearpath` (consumer credit repair).

Part of the [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack).
This file records only what ClearPath Business does inside it.

## Boundaries

### Owns

- the business-credit build pipeline (foundation → tier 1 → tier 2 → tier 3)
- vendor/tradeline records and bureau snapshots for each business
- per-business tasks, documents and the stage history
- the inbound lead inbox and the signed handoff to Denovo Credit
- the read-only client portal for a business file

### Consumes

- Denovo Credit's public identity (site, phone, support address)
- a webhook (or shared database) for lead delivery — configured, not assumed
- Cerulean (future): Authentik SSO, Vault secrets, DNS/TLS, NPM Edge

### Does not own

- consumer dispute pipeline, certified mailroom, PDF packages — those stay in
  `innotelinc/clearpath`
- identity (Authentik), secrets (Cerulean Vault), DNS/TLS (Cerulean)
- billing and payment processing
- credit bureau data acquisition: scores here are recorded from reports a human
  pulled, not fetched from a bureau API

## Relationship to clearpath

| Concern | clearpath | clearpath-business |
| --- | --- | --- |
| Subject | consumer (person) | business (entity) |
| Bureaus | Equifax, Experian, TransUnion | D&B, Experian Business, Equifax Business |
| Core object | dispute + mailroom item | tradeline + stage |
| Regime | CROA dispute workflow | commercial profile development |
| Shared | stack, session/CSRF patterns, tenant model, audit log | same |

They share conventions deliberately, not a database. A person can be a client of
both, and the two records must not be conflated.

## Service map

| Component | Technology | Job |
| --- | --- | --- |
| ClearPath Business | Node.js / Express / EJS | The business credit operating system for Denovo Credit. |
| Storage | SQLite (WAL) via `node:sqlite` | Workspace records, sessions, audit log. |
| Secrets | `.env` locally, Cerulean Vault in production | Webhook and handoff credentials. |
| Trust | Cerulean (DNS, TLS, hostname) | Public hostname and certificates. |
| Edge | NPM Edge | Public route in front of the service. |

## See also

- [README](../README.md)
- [Clearpath](https://github.com/innotelinc/clearpath)
- [Innotel Platform Stack](https://github.com/innotelinc/innotel-platform-stack)
