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
    name: "fieldservice.sid",
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
      maxAge: 60 * 60 * 1000,
      // Development: the app is used inside the Replit preview iframe, where
      // the browser treats it as third-party and withholds SameSite=Lax
      // cookies. SameSite=None (which requires Secure) lets the embedded
      // preview send the session cookie. The dev domain is always HTTPS via
      // the Replit proxy (trust proxy is enabled above).
      // Production: keep the stricter Lax + auto-secure behavior.
      ...(process.env.NODE_ENV === "production"
        ? {
            secure: "auto" as const,
            sameSite:
            (process.env.COOKIE_SAME_SITE as "lax" | "none" | "strict") ??
              "none",
          }
         : { secure: false, sameSite: "lax" }),

    },
  }),
);

app.use("/api", router);

// Serve the built frontend when STATIC_DIR points at a compiled SPA (the
// single-container Azure deployment pattern: this API server serves both the
// API and the static frontend from one origin). Not used in local dev, where
// Vite serves the frontend on its own port.
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
