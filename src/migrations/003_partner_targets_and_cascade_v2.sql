-- Generic partner targets (connector | customer_api)
CREATE TABLE IF NOT EXISTS partner_targets (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('connector', 'customer_api')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE,
  UNIQUE(partner_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_partner_targets_org_id ON partner_targets(org_id);
CREATE INDEX IF NOT EXISTS idx_partner_targets_partner_id ON partner_targets(partner_id);

-- Cascade policies v2 (generic target_type + target_id)
CREATE TABLE IF NOT EXISTS cascade_policies_v2 (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('connector', 'customer_api')),
  target_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  retries_max INTEGER NOT NULL DEFAULT 3,
  backoff_minutes INTEGER NOT NULL DEFAULT 60,
  sla_days INTEGER,
  attestation_required INTEGER NOT NULL DEFAULT 0,
  escalation_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE CASCADE,
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cascade_policies_v2_org_id ON cascade_policies_v2(org_id);

-- Extend cascade_jobs for generic targets (connector_id nullable for legacy)
-- SQLite: add columns with ALTER TABLE (run once per env)
ALTER TABLE cascade_jobs ADD COLUMN target_type TEXT;
ALTER TABLE cascade_jobs ADD COLUMN target_id TEXT;

-- Uniqueness for v2: (request_id, partner_id, target_type, target_id); legacy uses connector_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_cascade_jobs_request_partner_target
  ON cascade_jobs(request_id, partner_id, COALESCE(connector_id, ''), COALESCE(target_type, ''), COALESCE(target_id, ''));
