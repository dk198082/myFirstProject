-- Apply once against the EXTERNAL d365crm PostgreSQL mirror before enabling
-- CRM_INGESTION_ENABLED. Do not apply via the Replit managed DB publisher.
CREATE TABLE IF NOT EXISTS crm.calendar_ingest_state (
  entity text PRIMARY KEY,
  checkpoint timestamptz,
  last_attempt timestamptz,
  last_success timestamptz,
  row_count integer NOT NULL DEFAULT 0,
  last_error text
);