-- schema_migrations is created by MigrationRunner before applying migrations

-- Orgs (tenants)
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stripe_customer_id TEXT,
  setup_fee_paid_at TEXT
);

-- Users (org-scoped, RBAC)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER', 'ADMIN', 'VIEWER')),
  created_at TEXT NOT NULL,
  UNIQUE(org_id, email),
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Connectors (per org, for Docker Agent)
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  db_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_heartbeat_at TEXT,
  agent_version TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Connector tokens (hash only; plain token shown once on create/rotate)
CREATE TABLE IF NOT EXISTS connector_tokens (
  id TEXT PRIMARY KEY,
  connector_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
);

-- Hash recipes (p_hash versioned, per org)
CREATE TABLE IF NOT EXISTS hash_recipes (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  delimiter TEXT,
  fields_json TEXT NOT NULL,
  normalization_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Partners (per org)
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT,
  endpoint_url TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Partner links (partner <-> connector)
CREATE TABLE IF NOT EXISTS partner_links (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE,
  UNIQUE(partner_id, connector_id)
);

-- Cascade policies (partner + connector)
CREATE TABLE IF NOT EXISTS cascade_policies (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  retries_max INTEGER NOT NULL DEFAULT 3,
  backoff_minutes INTEGER NOT NULL DEFAULT 60,
  sla_days INTEGER,
  attestation_required INTEGER NOT NULL DEFAULT 0,
  escalation_email TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
);

-- Runs (execution records per connector)
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('DRY_RUN', 'ENFORCE')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT NOT NULL,
  stats_json TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE
);

-- Deletion requests (hashes only, no PII)
CREATE TABLE IF NOT EXISTS deletion_requests (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_ref TEXT,
  subject_hash TEXT NOT NULL,
  payload_hash TEXT,
  system TEXT,
  status TEXT NOT NULL,
  received_at TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Audit events (append-only, per org)
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  type TEXT NOT NULL,
  actor TEXT,
  details_json TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE
);

-- Cascade jobs (per request/partner/connector)
CREATE TABLE IF NOT EXISTS cascade_jobs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (request_id) REFERENCES deletion_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  FOREIGN KEY (connector_id) REFERENCES connectors(id) ON DELETE CASCADE,
  UNIQUE(request_id, partner_id, connector_id)
);

-- Attestations (proofs for cascade jobs)
CREATE TABLE IF NOT EXISTS attestations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  cascade_job_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  status TEXT NOT NULL,
  proof_hash TEXT,
  details_json TEXT,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (cascade_job_id) REFERENCES cascade_jobs(id) ON DELETE CASCADE
);

-- Leads (public early access, no org)
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  company TEXT,
  role TEXT,
  source TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_connectors_org_id ON connectors(org_id);
CREATE INDEX IF NOT EXISTS idx_connector_tokens_connector_id ON connector_tokens(connector_id);
CREATE INDEX IF NOT EXISTS idx_hash_recipes_org_id ON hash_recipes(org_id);
CREATE INDEX IF NOT EXISTS idx_partners_org_id ON partners(org_id);
CREATE INDEX IF NOT EXISTS idx_partner_links_org_id ON partner_links(org_id);
CREATE INDEX IF NOT EXISTS idx_cascade_policies_org_id ON cascade_policies(org_id);
CREATE INDEX IF NOT EXISTS idx_runs_org_id ON runs(org_id);
CREATE INDEX IF NOT EXISTS idx_runs_connector_id ON runs(connector_id);
CREATE INDEX IF NOT EXISTS idx_deletion_requests_org_id ON deletion_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_org_id ON audit_events(org_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_request_id ON audit_events(request_id);
CREATE INDEX IF NOT EXISTS idx_cascade_jobs_org_id ON cascade_jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_cascade_jobs_request_id ON cascade_jobs(request_id);
CREATE INDEX IF NOT EXISTS idx_attestations_org_id ON attestations(org_id);
