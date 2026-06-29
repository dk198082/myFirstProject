import express, { type Express } from "express";
import cors from "cors";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { localPool } from "./lib/localDb";

const app: Express = express();

// Trust the Replit reverse proxy so secure cookies and the forwarded protocol
// are handled correctly.
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
app.use(cors());
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
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 8,
    },
  }),
);

app.use("/api", router);

export default app;
