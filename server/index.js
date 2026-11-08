import express from "express";
import os from "node:os";
import path from "node:path";
import { env, rootDir } from "./env.js";
import {
  STAGES,
  db,
  defaultTenant,
  ensureBootstrap,
  seedDemo,
  tenantForHost,
  tenantStats,
} from "./db.js";
import { attachSession, checkCsrf, requireUser } from "./auth.js";
import {
  fmtDate,
  fmtDay,
  initials,
  money,
  percent,
  product,
  stageClass,
  stageName,
  stageTier,
  statusClass,
} from "./util.js";
import adminRoutes from "./routes/admin.js";
import authRoutes from "./routes/auth.js";
import denovoRoutes from "./routes/denovo.js";
import intakeRoutes from "./routes/intake.js";
import portalRoutes from "./routes/portal.js";
import publicRoutes from "./routes/public.js";

const bootstrap = ensureBootstrap();
if (bootstrap.created) {
  console.log(`ClearPath Business: owner account created for ${env.adminEmail}`);
  if (bootstrap.demoPassword) {
    console.log(`ClearPath Business: demo password ${bootstrap.demoPassword} — set PLATFORM_ADMIN_PASSWORD`);
  }
}
if (env.seedDemo) {
  const seeded = seedDemo();
  if (seeded) console.log(`ClearPath Business: seeded ${seeded} demonstration businesses`);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(rootDir, "views"));

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  if (env.cookieSecure) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

app.use("/assets", express.static(path.join(rootDir, "public"), { etag: true, index: false }));

app.get("/healthz", (req, res) => {
  try {
    const tenant = defaultTenant();
    res.json({ ok: Boolean(tenant), service: "clearpath-business", time: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, error: "database unavailable" });
  }
});

// Signed handoff from Denovo Credit. Raw body: the signature covers the exact
// bytes, so this is mounted before the JSON parser and before cookie auth.
app.use("/api/denovo", express.raw({ type: "application/json", limit: "256kb" }), denovoRoutes);

app.use(express.urlencoded({ extended: false, limit: "256kb" }));
app.use(express.json({ limit: "256kb" }));

// Public lead intake is deliberately mounted before the session and CSRF
// pipeline: it is an unauthenticated form, it touches no existing record, and
// it is rate limited plus honeypotted instead.
app.use("/", intakeRoutes);

app.use(attachSession);

app.use((req, res, next) => {
  res.locals.product = product;
  res.locals.path = req.path;
  res.locals.query = req.query;
  res.locals.notice = typeof req.query.notice === "string" ? req.query.notice.slice(0, 300) : "";
  res.locals.error = typeof req.query.error === "string" ? req.query.error.slice(0, 300) : "";
  res.locals.csrf = res.locals.csrf || "";
  res.locals.tenant = res.locals.tenant || tenantForHost(req.headers.host) || defaultTenant();
  res.locals.stages = STAGES;
  res.locals.money = money;
  res.locals.fmtDate = fmtDate;
  res.locals.fmtDay = fmtDay;
  res.locals.initials = initials;
  res.locals.stageClass = stageClass;
  res.locals.stageName = stageName;
  res.locals.stageTier = stageTier;
  res.locals.statusClass = statusClass;
  res.locals.percent = percent;
  res.locals.nav = res.locals.tenant ? tenantStats(res.locals.tenant.id) : null;
  next();
});

app.use(checkCsrf);

app.use("/", authRoutes);
app.use("/", publicRoutes);
app.use("/app", requireUser(["owner", "specialist"]), adminRoutes);
app.use("/portal", requireUser(["client"]), portalRoutes);

app.use((req, res) => {
  res.status(404).render("error", {
    title: "Not found",
    status: 404,
    message: "That page does not exist. Head back to the workspace and try again.",
  });
});

app.use((err, req, res, next) => {
  console.error("ClearPath Business error:", err);
  if (res.headersSent) return next(err);
  const status = err.status || 500;
  res.status(status).render("error", {
    title: "Something went wrong",
    status,
    message: "The request could not be completed. Try again, or contact support if it keeps happening.",
  });
});

const server = app.listen(env.port, () => {
  console.log(`ClearPath Business listening on http://localhost:${env.port} (${os.hostname()})`);
});

const cleanup = setInterval(() => {
  try {
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  } catch {
    /* a failed sweep is not worth crashing over */
  }
}, 60 * 60 * 1000);
cleanup.unref?.();

function shutdown(signal) {
  console.log(`ClearPath Business: ${signal}, closing`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

export default app;
