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

// Trust the reverse proxy (Replit preview, or Azure App Service/Container
// Apps in production) so secure cookies and the forwarded protocol are
// handled correctly.
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
// CORS_ORIGIN lets Azure deployments restrict cross-origin requests to the
// deployed frontend origin(s) (comma-separated). Unset in single-container
// deployments where the frontend is served from this same Express app.
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
      maxAge: 1000 * 60 * 60 * 24 * 30,
      // Development: the app is used inside the Replit preview iframe, where
      // the browser treats it as third-party and withholds SameSite=Lax
      // cookies. SameSite=None (which requires Secure) lets the embedded
      // preview send the session cookie. The dev domain is always HTTPS via
      // the Replit proxy (trust proxy is enabled above).
      // Production: keep the stricter Lax + auto-secure behavior.
      ...(process.env.NODE_ENV === "production"
        ? { secure: "auto" as const, sameSite: "lax" as const }
        : { secure: true, sameSite: "none" as const }),
    },
  }),
);

app.use("/api", router);

// Serve the built frontends when the corresponding STATIC_* env vars point
// at compiled SPAs (the single-container Azure deployment pattern: this API
// server also serves the static frontends from one origin, so the session
// cookie stays same-site and only one Azure resource is needed). Unset in
// local dev, where each Vite dev server serves its own frontend on its own
// port instead.
//
// Pro Forma Service Invoice is mounted under /pro-forma-service-invoice/,
// matching its own BASE_PATH (see artifacts/pro-forma-service-invoice's
// .replit-artifact/artifact.toml and vite.config.ts) — mounted BEFORE the
// Field Service Calendar's root catch-all below, since Express matches
// middleware in registration order and the calendar's SPA fallback would
// otherwise shadow this sub-path.
const staticProFormaDir = process.env.STATIC_PRO_FORMA_DIR;
if (staticProFormaDir) {
  const resolvedProFormaDir = path.resolve(staticProFormaDir);
  const proFormaIndex = path.join(resolvedProFormaDir, "index.html");
  if (fs.existsSync(proFormaIndex)) {
    app.use("/pro-forma-service-invoice", express.static(resolvedProFormaDir));
    app.get(/^\/pro-forma-service-invoice(\/.*)?$/, (_req, res) => {
      res.sendFile(proFormaIndex);
    });
  } else {
    logger.warn(
      { staticProFormaDir: resolvedProFormaDir },
      "STATIC_PRO_FORMA_DIR is set but no index.html was found there; the Pro Forma Service Invoice app will not be served from this process.",
    );
  }
}

// Field Service Calendar owns the site root and is the catch-all SPA
// fallback for anything not matched above and not under /api.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  if (fs.existsSync(resolvedStaticDir)) {
    app.use(express.static(resolvedStaticDir));
    // Express 5's router (path-to-regexp v8) rejects a bare "*" pattern, so
    // the SPA fallback is a path-less middleware instead of app.get("*", ...).
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) return next();
      res.sendFile(path.join(resolvedStaticDir, "index.html"));
    });
  } else {
    logger.warn(
      { staticDir: resolvedStaticDir },
      "STATIC_DIR is set but does not exist; the frontend will not be served from this process.",
    );
  }
}

export default app;
