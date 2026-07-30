---
name: Azure PostgreSQL native auth
description: How to connect to the production Azure PostgreSQL Flexible Server using native password auth (not AAD tokens)
---

**Why AAD fails:** If the pg driver sees an email-format username (containing @), Azure PG treats it as an AAD identity and demands a JWT token. Use the plain native PostgreSQL role name stored in AZURE_PG_SP_USER env var (not AZURE_PG_USER which is email format).

**SSL:** Use `ssl: true` — Azure PG Flexible Server uses DigiCert certs that Node.js trusts natively. Full certificate verification works; do NOT use `rejectUnauthorized: false`.

**How to apply:** Read username from AZURE_PG_SP_USER. Read password from PG_NATIVE_PASSWORD secret. Use `ssl: true`. Never append @servername to the username.

**Stored functions (not procedures):** d365fo.productionordersd365us() and d365fo.productionroutedetailsd365() are PostgreSQL functions called with SELECT * FROM. They return all rows; WHERE clauses filter after. Both are slow (full scans — productionroutedetailsd365 returns ~2651 rows). Always try function first, fall back to direct table query for production-orders; return 500 on failure for route-details.

**productionstatus is numeric:** D365FO returns numeric status codes (0=Created…7=Ordered). Cast to integer from proc results: `productionorderstatus::integer`. The summary/table queries return integer natively.
