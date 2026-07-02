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
app.use(express.json());
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
    cookie: {
      secure: "auto",
      httpOnly: true,
      // "lax" works for same-origin deployment (default; see STATIC_DIR
      // below). Only set COOKIE_SAME_SITE=none (and CORS_ORIGIN above) if the
      // frontend is deployed to a different Azure host than this API — the
      // frontend must also send fetch(..., { credentials: "include" }) in
      // that case, or the browser will never attach the session cookie.
      sameSite: (process.env.COOKIE_SAME_SITE as "lax" | "none" | "strict") ?? "lax",
      maxAge: 1000 * 60 * 60 * 8,
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
  // after "/api" so API routes/404s above are never shadowed by this.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

export default app;
