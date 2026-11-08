import { Router } from "express";
import { STAGES, db } from "../db.js";

const router = Router();

function businessFor(req) {
  if (!req.user.business_id) return null;
  return db
    .prepare("SELECT * FROM businesses WHERE id = ? AND tenant_id = ?")
    .get(req.user.business_id, req.user.tenant_id);
}

router.get("/", (req, res) => {
  const business = businessFor(req);
  if (!business) {
    return res.render("portal/home", {
      title: "Your file",
      page: "portal",
      business: null,
      stages: STAGES,
      tradelines: [],
      bureaus: [],
      tasks: [],
      documents: [],
    });
  }
  const tenantId = req.user.tenant_id;
  res.render("portal/home", {
    title: business.name,
    page: "portal",
    business,
    stages: STAGES,
    tradelines: db
      .prepare("SELECT * FROM tradelines WHERE tenant_id = ? AND business_id = ? ORDER BY tier, opened_on DESC")
      .all(tenantId, business.id),
    bureaus: db
      .prepare(
        "SELECT * FROM bureau_reports WHERE tenant_id = ? AND business_id = ? ORDER BY pulled_on DESC LIMIT 6"
      )
      .all(tenantId, business.id),
    tasks: db
      .prepare("SELECT * FROM tasks WHERE tenant_id = ? AND business_id = ? ORDER BY status, due_on")
      .all(tenantId, business.id),
    documents: db
      .prepare("SELECT * FROM documents WHERE tenant_id = ? AND business_id = ? ORDER BY created_at DESC")
      .all(tenantId, business.id),
  });
});

export default router;
