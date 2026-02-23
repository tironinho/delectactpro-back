-- Idempotent Stripe event processing
CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  processed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('processed', 'ignored', 'failed')),
  error_message TEXT,
  created_at TEXT NOT NULL,
  payload_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_stripe_event_id ON stripe_events(stripe_event_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_created_at ON stripe_events(created_at);

-- Payments (setup fee and future recurring)
CREATE TABLE IF NOT EXISTS billing_payments (
  id TEXT PRIMARY KEY,
  org_id TEXT,
  lead_id INTEGER,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  stripe_customer_id TEXT,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'refunded')),
  plan_id TEXT NOT NULL,
  email TEXT,
  company_name TEXT,
  metadata_json TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (org_id) REFERENCES orgs(id) ON DELETE SET NULL,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_billing_payments_org_id ON billing_payments(org_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_lead_id ON billing_payments(lead_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_stripe_session ON billing_payments(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_billing_payments_stripe_pi ON billing_payments(stripe_payment_intent_id);

-- Extend leads for UTM/source (optional columns; SQLite ADD COLUMN)
ALTER TABLE leads ADD COLUMN source_page TEXT;
ALTER TABLE leads ADD COLUMN utm_json TEXT;
ALTER TABLE leads ADD COLUMN updated_at TEXT;
