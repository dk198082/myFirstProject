require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const msal = require("@azure/msal-node");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

// Azure App Registration credentials. The reference used ENTRA_* names; this
// project already stores the same app registration under CLIENT_ID / TENANT_ID /
// CLIENT_SECRET, so we accept either.
const CLIENT_ID = process.env.ENTRA_CLIENT_ID || process.env.CLIENT_ID;
const TENANT_ID = process.env.ENTRA_TENANT_ID || process.env.TENANT_ID;
const CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET || process.env.CLIENT_SECRET;

// The redirect URI must exactly match one registered on the Azure app
// registration. Falls back to the current Replit domain when not set.
const REDIRECT_URI =
  process.env.ENTRA_REDIRECT_URI ||
  (process.env.REPLIT_DOMAINS
    ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/auth/callback`
    : "http://localhost:3000/auth/callback");

// Fail fast on misconfiguration instead of erroring opaquely at request time.
const requiredEnv = {
  CLIENT_ID,
  TENANT_ID,
  CLIENT_SECRET,
  SESSION_SECRET: process.env.SESSION_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
};
const missingEnv = Object.entries(requiredEnv)
  .filter(([, value]) => !value)
  .map(([key]) => key);
if (missingEnv.length > 0) {
  console.error(`Missing required environment variables: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

const msalClient = new msal.ConfidentialClientApplication({
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    clientSecret: CLIENT_SECRET,
  },
});

app.get("/login", async (req, res) => {
  // Bind the request to the session with a random state value to defend against
  // login CSRF / authorization-response injection.
  const state = crypto.randomBytes(16).toString("hex");
  req.session.authState = state;

  const authUrl = await msalClient.getAuthCodeUrl({
    scopes: ["openid", "profile", "email"],
    redirectUri: REDIRECT_URI,
    state,
  });

  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  try {
    // Verify the state matches what we issued before exchanging the code.
    if (!req.query.state || req.query.state !== req.session.authState) {
      return res.status(403).send("Invalid state parameter");
    }
    delete req.session.authState;

    const tokenResponse = await msalClient.acquireTokenByCode({
      code: req.query.code,
      scopes: ["openid", "profile", "email"],
      redirectUri: REDIRECT_URI,
    });

    const claims = tokenResponse.idTokenClaims;

    const entraOid = claims.oid;
    const email = claims.preferred_username || claims.email || claims.upn;

    const displayName = claims.name;

    const result = await pool.query(
      `
      SELECT entra_oid, email, display_name, role
      FROM app.app_user
      WHERE entra_oid = $1
        AND is_active = true
      `,
      [entraOid]
    );

    if (result.rowCount === 0) {
      return res.status(403).send("User is authenticated but not authorized.");
    }

    req.session.user = {
      entraOid,
      email,
      displayName,
      role: result.rows[0].role,
    };

    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed");
  }
});

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ message: "Login required" });
  }

  next();
}

function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.session.user) {
      return res.status(401).json({ message: "Login required" });
    }

    if (!roles.includes(req.session.user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    next();
  };
}

app.get("/api/me", requireLogin, (req, res) => {
  res.json(req.session.user);
});

app.patch(
  "/api/bookings/:bookingId",
  requireLogin,
  requireRole("admin", "dispatcher"),
  async (req, res) => {
    res.json({
      message: "Booking update allowed",
      user: req.session.user,
      bookingId: req.params.bookingId,
    });
  }
);

app.get("/api/technician/jobs", requireRole("technician", "admin"), async (req, res) => {
  res.json({
    message: "Technician jobs visible",
    user: req.session.user,
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect(
      `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/logout`
    );
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
