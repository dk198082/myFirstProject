import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { localPool } from "./lib/localDb";

const app: Express = express();

// Trust the first reverse proxy hop (Replit's proxy in dev/Replit prod, Azure
// App Service's / Azure Container Apps' front end in Azure) so `req.secure`,
// `req.protocol` and the session cookie's `secure: "auto"` are derived from
// the `X-Forwarded-*` headers instead of the (plain HTTP) hop to this process.
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// CORS_ORIGIN is only needed if the frontend is deployed separately from this
// API (e.g. a second Azure Static Web App instead of STATIC_DIR mode below).
// Comma-separated list of allowed origins, e.g. "https://myapp.z1.web.core.windows.net".
// Left unset, cors() reflects no restriction (fine for same-origin STATIC_DIR
// mode, where the browser never makes a cross-origin request in the first place).
const corsOrigins = process.env.CORS_ORIGIN?.split(",")
  .map((o) => o.trim())
  .filter(Boolean);
app.use(
  cors(
    corsOrigins?.length
      ? { origin: corsOrigins, credentials: true }
      : undefined,
  ),
);
// The calendar-report email route posts a base64-encoded PDF (~0.5–4 MB) so we
// raise the JSON limit to 5 MB. All other routes stay well under this threshold
// and Zod schema validation still guards what each handler actually accepts.
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

const PgSession = connectPgSimple(session);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production");
  }
  logger.warn(
    "SESSION_SECRET is not set; using an insecure development-only secret. Set SESSION_SECRET before deploying.",
  );
}
app.use(
  session({
    // The "sessions" table is provisioned out of band (see repl docs), so we do
    // not let connect-pg-simple create it — its bundled table.sql is not available
    // after esbuild bundling. The table needs columns sid (PK), sess (jsonb),
    // expire, plus an index on expire, in every environment (dev and production).
    store: new PgSession({
      pool: localPool,
      schemaName: "crm",
      tableName: "sessions",
      createTableIfMissing: false,
    }),
    secret: sessionSecret ?? "insecure-dev-session-secret",
    resave: false,
    saveUninitialized: false,
    // Refresh the cookie expiry on every request so active users are never
    // logged out; only 30 days of inactivity ends a session.
    rolling: true,
    cookie: {
      httpOnly: true,
      maxAge: 60 * 60 * 1000,
      // Development: the app is used inside the Replit preview iframe, where
      // the browser treats it as third-party and withholds SameSite=Lax
      // cookies. SameSite=None (which requires Secure) lets the embedded
      // preview send the session cookie. The dev domain is always HTTPS via
      // the Replit proxy (trust proxy is enabled above).
      // Production: keep the stricter Lax + auto-secure behavior by default.
      // Only set COOKIE_SAME_SITE=none (and CORS_ORIGIN above) in production
      // if the frontend is deployed to a different Azure host than this API —
      // the frontend must also send fetch(..., { credentials: "include" }) in
      // that case, or the browser will never attach the session cookie.
      ...(process.env.NODE_ENV === "production"
        ? {
            secure: "auto",
            sameSite:
              (process.env.COOKIE_SAME_SITE as "lax" | "none" | "strict") ??
              ("lax"),
          }
        : { secure: false, sameSite: "lax"})
    },
  }),
);

app.use("/api", router);

// --- AZURE DEPLOYMENT ---------------------------------------------------
// Optional single-service mode: if STATIC_DIR points at the built frontend
// (artifacts/field-service-schedule-board/dist/public), this API server also
// serves it, so the whole app runs as ONE Azure App Service / Container Apps
// instance on ONE origin. That keeps the session cookie same-site/same-origin
// and avoids needing CORS credentials + a second Azure resource.
// Unset in local dev (the Vite dev server serves the frontend on its own
// port instead) and set by ./Dockerfile / AZURE_DEPLOYMENT.md in production.
//
// STATIC_TRAINING_DECK_DIR is optional and separate: if set, it serves the
// fs-training-deck slide deck at /fs-training-deck/, matching the path
// Replit's own path-router config uses for it (see
// artifacts/fs-training-deck/.replit-artifact/artifact.toml). It's a static,
// API-free presentation, so unlike the main frontend it has no session/CORS
// implications either way — mounting it here is purely a convenience so it
// doesn't need its own Azure resource.
const staticTrainingDeckDir = process.env.STATIC_TRAINING_DECK_DIR;
if (staticTrainingDeckDir) {
  const resolvedTrainingDeckDir = path.resolve(staticTrainingDeckDir);
  const trainingDeckIndex = path.join(resolvedTrainingDeckDir, "index.html");
  if (!fs.existsSync(trainingDeckIndex)) {
    throw new Error(
      `STATIC_TRAINING_DECK_DIR is set to "${resolvedTrainingDeckDir}" but no index.html was found there. ` +
        "Build fs-training-deck first (see AZURE_DEPLOYMENT.md).",
    );
  }
  // Mounted BEFORE the main STATIC_DIR catch-all below, so this subpath is
  // matched first (Express checks middleware in registration order).
  app.use("/fs-training-deck", express.static(resolvedTrainingDeckDir));
  app.get(/^\/fs-training-deck(\/.*)?$/, (_req, res) => {
    res.sendFile(trainingDeckIndex);
  });
}

const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  if (!fs.existsSync(path.join(resolvedStaticDir, "index.html"))) {
    throw new Error(
      `STATIC_DIR is set to "${resolvedStaticDir}" but no index.html was found there. ` +
        "Build the frontend first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use(express.static(resolvedStaticDir));
  // SPA fallback: any non-API, non-file GET request returns index.html so
  // client-side routing (wouter) can handle the path. Must be registered
  // after "/api" (and after the training-deck mount above) so those routes
  // are never shadowed by this catch-all.
  app.get(/^(?!\/api\/)(?!\/fs-training-deck).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

export default app;
