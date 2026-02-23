-- Customer API integrations (BYO API: health/delete/status/webhook)
CREATE TABLE IF NOT EXISTS customer_api_integrations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  health_path TEXT NOT NULL DEFAULT '/deleteactpro/health',
  delete_path TEXT NOT NULL DEFAULT '/deleteactpro/delete',
  status_path TEXT NOT NULL DEFAULT '/deleteactpro/status',
  webhook_path TEXT,
  auth_type TEXT NOT NULL CHECK (auth_type IN ('HMAC', 'BEARER', 'NONE')),
  shared_secret_encrypted TEXT,
  bearer_token_encrypted TEXT,
  headers_json TEXT,
  timeout_ms INTEGER NOT NULL DEFAULT 8000,
  retries INTEGER NOT NULL DEFAULT 2,
  hmac_header_name TEXT NOT NULL DEFAULT 'X-DAP-Signature',
  timestamp_header_name TEXT NOT NULL DEFAULT 'X-DAP-Timestamp',
  replay_window_seconds INTEGER NOT NULL DEFAULT 300,
  last_healthcheck_at TEXT,
  last_healthcheck_ok INTEGER,
  last_healthcheck_status INTEGER,
  last_healthcheck_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_customer_api_integrations_org_id ON customer_api_integrations(org_id);
CREATE INDEX IF NOT EXISTS idx_customer_api_integrations_org_updated ON customer_api_integrations(org_id, updated_at);
