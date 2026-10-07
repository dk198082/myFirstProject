require("dotenv").config();

const express = require("express");
const session = require("express-session");
const msal = require("@azure/msal-node");
const { Pool } = require("pg");

const app = express();
app.set("trust proxy", 1);
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
       secure: true,
      httpOnly: true,
      sameSite: "lax"
    }
  })
);

const msalClient = new msal.ConfidentialClientApplication({
  auth: {
    clientId: process.env.ENTRA_CLIENT_ID,
    authority: `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}`,
    clientSecret: process.env.ENTRA_CLIENT_SECRET
  }
});

app.get("/login", async (req, res) => {
  const authUrl = await msalClient.getAuthCodeUrl({
    scopes: ["openid", "profile", "email"],
    redirectUri: process.env.ENTRA_REDIRECT_URI
  });

  res.redirect(authUrl);
});

app.get("/auth/callback", async (req, res) => {
  try {
    const tokenResponse = await msalClient.acquireTokenByCode({
      code: req.query.code,
      scopes: ["openid", "profile", "email"],
      redirectUri: process.env.ENTRA_REDIRECT_URI
    });

    const claims = tokenResponse.idTokenClaims;

    const entraOid = claims.oid;
    const email =
      claims.preferred_username ||
      claims.email ||
      claims.upn;

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
      role: result.rows[0].role
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
      bookingId: req.params.bookingId
    });
  }
);

app.get("/api/technician/jobs", requireRole("technician", "admin"), async (req, res) => {
  res.json({
    message: "Technician jobs visible",
    user: req.session.user
  });
});

app.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect(
      `https://login.microsoftonline.com/${process.env.ENTRA_TENANT_ID}/oauth2/v2.0/logout`
    );
  });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});