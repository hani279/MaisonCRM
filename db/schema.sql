-- Table names are unqualified on purpose: this file is applied once per
-- Postgres schema (public for real data, demo for demo data) with
-- search_path already pointed at the target schema by the caller.

CREATE TABLE IF NOT EXISTS pipeline_stages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('client', 'partner')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_name TEXT,
  contact_name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  notes TEXT,
  stage_id BIGINT NOT NULL REFERENCES pipeline_stages(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clients (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  budget_label TEXT,
  stage_id BIGINT NOT NULL REFERENCES pipeline_stages(id),
  status TEXT NOT NULL DEFAULT 'cold' CHECK (status IN ('cold', 'engaged', 'active', 'settled', 'lost')),
  next_action_label TEXT,
  next_action_date TEXT,
  referred_by_partner_id BIGINT REFERENCES partners(id) ON DELETE SET NULL,
  referral_fee_note TEXT,
  notes TEXT,
  archived_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS call_logs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call', 'text', 'voicemail')),
  note TEXT,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One tiny scoped fact per schema: whether this deployment's first admin
-- account has been created yet. Needed because Supabase Auth's user list is
-- project-wide, not schema-scoped, so it can't answer "has *this* deployment
-- (public vs demo) completed setup" on its own — the demo schema's own
-- permanent login would otherwise make the real app skip first-run setup.
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Mirrors the subset of each Supabase Auth user (scoped to this schema, see
-- routes/users.js) that's useful to have as a normal queryable/joinable row
-- rather than locked inside Auth's own auth.users table. Kept in sync by the
-- app on create/delete; it is a mirror, not the source of truth — Auth stays
-- authoritative for login. id matches the Auth user's id (no FK: auth.users
-- lives in a different Postgres schema).
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS labels (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#0071e3',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_labels (
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, label_id)
);

CREATE TABLE IF NOT EXISTS partner_labels (
  partner_id BIGINT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  label_id BIGINT NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (partner_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_clients_stage ON clients(stage_id);
CREATE INDEX IF NOT EXISTS idx_partners_stage ON partners(stage_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_client_labels_label ON client_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_partner_labels_label ON partner_labels(label_id);

ALTER TABLE app_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_labels ENABLE ROW LEVEL SECURITY;
-- No policies are defined, so RLS denies all access to anon/authenticated
-- roles by default. The Express backend talks to Postgres with the
-- service-role key, which bypasses RLS entirely, so it's unaffected.
