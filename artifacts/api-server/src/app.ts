import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the first reverse proxy hop (Azure App Service's / Azure Container
// Apps' front end) so req.secure/req.protocol reflect the original client
// request instead of the plain-HTTP hop to this process. Harmless in dev,
// where there's no reverse proxy in front of the server at all.
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

app.use("/api", router);

// --- AZURE DEPLOYMENT ---------------------------------------------------
// Optional single-service mode: if STATIC_ROOT_DIR is set, this API server
// also serves all four frontends (each built with BASE_PATH=/apps/<name>/ —
// see ./Dockerfile), so the whole app runs as ONE Azure App Service /
// Container Apps instance instead of five separate Azure resources.
// Unset in local dev (each Vite dev server serves its own app on its own
// port instead).
const STATIC_APPS = [
  "shop-floor",
  "shop-floor-mobile",
  "production-booking",
  "new-booking-schedule",
] as const;

const staticRootDir = process.env.STATIC_ROOT_DIR;
if (staticRootDir) {
  const resolvedRoot = path.resolve(staticRootDir);
  for (const appName of STATIC_APPS) {
    const appDir = path.join(resolvedRoot, appName);
    const indexHtml = path.join(appDir, "index.html");
    if (!fs.existsSync(indexHtml)) {
      throw new Error(
        `STATIC_ROOT_DIR is set to "${resolvedRoot}" but "${appName}/index.html" was not found there. ` +
          "Build all four frontends first (see AZURE_DEPLOYMENT.md).",
      );
    }
    const mountPath = `/apps/${appName}`;
    app.use(mountPath, express.static(appDir));
    // SPA fallback: any non-file GET under this app's path returns its
    // index.html so client-side routing can handle the rest.
    app.get(new RegExp(`^/apps/${appName}(/.*)?$`), (_req, res) => {
      res.sendFile(indexHtml);
    });
  }
  // Simple landing page at "/" linking to all four — there's no single
  // "main" app among these, so we don't guess which one should own the root.
  app.get("/", (_req, res) => {
    res.type("html").send(
      "<!doctype html><html><body><h1>Production Calendar</h1><ul>" +
        STATIC_APPS.map(
          (a) => `<li><a href="/apps/${a}/">${a}</a></li>`,
        ).join("") +
        "</ul></body></html>",
    );
  });
}

export default app;
