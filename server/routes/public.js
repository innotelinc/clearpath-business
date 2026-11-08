import { Router } from "express";
import { defaultTenant, tenantForHost } from "../db.js";
import { env } from "../env.js";
import { product } from "../util.js";

const router = Router();

const legal = {
  privacy: {
    title: "Privacy notice",
    intro:
      "ClearPath Business stores business and contact records in a local SQLite database on the server that runs it. No analytics, advertising pixels or third-party trackers are loaded.",
    sections: [
      [
        "What we collect",
        "Business details you or your specialist enter — entity name, EIN, DUNS, revenue, owner contact information — vendor and tradeline records, bureau scores you provide, and an audit log of changes. Passwords are stored as salted scrypt hashes, never in plain text.",
      ],
      [
        "How it is used",
        "Solely to operate the business credit build and the client portal: sequencing vendor applications, tracking payments and bureau reporting, and preparing a lender package.",
      ],
      [
        "Sharing with Denovo Credit",
        "New inquiries are forwarded to the Denovo Credit team so a human can follow up. Business credit work is not sold to lead marketplaces and your file is never listed for resale.",
      ],
      [
        "Retention",
        "Records remain until the workspace deletes them or the deployment is removed. A production deployment should define a written retention schedule and honour deletion requests.",
      ],
      [
        "Your choices",
        "Contact the agency that invited you to the portal to access, correct or delete your information.",
      ],
    ],
  },
  terms: {
    title: "Terms of use",
    intro:
      "ClearPath Business is software for business credit consulting and credit repair agencies. It is not a lender, a credit bureau, or a law firm, and it does not provide legal advice.",
    sections: [
      [
        "No guarantees",
        "Vendor approvals, credit limits, scores and funding outcomes are decided by third parties. No score change, limit or approval is guaranteed, and timelines depend on payment history and bureau processing.",
      ],
      [
        "Acceptable use",
        "Use the workspace only for lawful applications supported by real business records. Do not submit false documents, apply in another company's name, or misrepresent revenue.",
      ],
      [
        "Accounts",
        "Workspace administrators are responsible for their team's access and for revoking it when someone leaves. Client portal accounts are personal and must not be shared.",
      ],
      ["Contact", `Questions about these terms: ${product.support}.`],
    ],
  },
};

router.get("/", (req, res) => {
  res.render("landing", {
    title: `${product.name} — business credit, built for ${product.company}`,
    tenant: tenantForHost(req.headers.host) || defaultTenant(),
    page: "home",
    sent: req.query.sent === "1",
    denovoSite: env.denovoSite,
  });
});

router.get("/legal/:doc", (req, res, next) => {
  const doc = legal[req.params.doc];
  if (!doc) return next();
  res.render("legal", {
    title: `${doc.title} — ${product.name}`,
    doc,
    page: "legal",
  });
});

router.get("/robots.txt", (req, res) => {
  res.type("text/plain").send("User-agent: *\nDisallow: /app\nDisallow: /portal\nAllow: /\n");
});

export default router;
