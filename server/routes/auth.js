import { Router } from "express";
import { defaultTenant, tenantForHost } from "../db.js";
import {
  authenticate,
  clearThrottle,
  destroySession,
  issueSession,
  throttle,
} from "../auth.js";
import { safeNext } from "../util.js";

const router = Router();

function tenantFor(req) {
  return tenantForHost(req.headers.host) || defaultTenant();
}

async function handleLogin(req, res, { role, view }) {
  const tenant = tenantFor(req);
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const next = safeNext(req.body?.next, role === "client" ? "/portal" : "/app");
  const key = `login:${req.ip}:${email}`;

  if (!tenant) {
    return res.status(400).render(view, { title: "Sign in", error: "Workspace not configured.", next, role });
  }
  if (throttle(key, { max: 10 })) {
    return res.status(429).render(view, {
      title: "Sign in",
      error: "Too many attempts. Wait a few minutes and try again.",
      next,
      role,
    });
  }

  const user = authenticate(tenant.id, email, password);
  const roleOk = user && (role === "client" ? user.role === "client" : user.role !== "client");

  if (!user || !roleOk) {
    return res.status(401).render(view, {
      title: "Sign in",
      error: "That email and password do not match an account here.",
      next,
      role,
    });
  }

  clearThrottle(key);
  issueSession(res, user);
  return res.redirect(303, next);
}

router.get("/login", (req, res) => {
  if (req.user) return res.redirect(302, req.user.role === "client" ? "/portal" : "/app");
  res.render("login", {
    title: "Sign in",
    role: "staff",
    next: safeNext(req.query.next, "/app"),
    error: "",
  });
});

router.post("/login", (req, res) =>
  handleLogin(req, res, { role: "staff", view: "login" })
);

router.get("/portal/login", (req, res) => {
  if (req.user) return res.redirect(302, req.user.role === "client" ? "/portal" : "/app");
  res.render("login", {
    title: "Client sign in",
    role: "client",
    next: safeNext(req.query.next, "/portal"),
    error: "",
  });
});

router.post("/portal/login", (req, res) =>
  handleLogin(req, res, { role: "client", view: "login" })
);

router.post("/logout", (req, res) => {
  destroySession(req, res);
  res.redirect(303, "/");
});

export default router;
