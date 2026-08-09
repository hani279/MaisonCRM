CREATE TABLE IF NOT EXISTS pipeline_stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline TEXT NOT NULL CHECK (pipeline IN ('client', 'partner')),
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS partners (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_name TEXT,
  contact_name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  notes TEXT,
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  budget_label TEXT,
  stage_id INTEGER NOT NULL REFERENCES pipeline_stages(id),
  status TEXT NOT NULL DEFAULT 'cold' CHECK (status IN ('cold', 'engaged', 'active', 'settled', 'lost')),
  next_action_label TEXT,
  next_action_date TEXT,
  referred_by_partner_id INTEGER REFERENCES partners(id) ON DELETE SET NULL,
  referral_fee_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('call', 'text', 'voicemail')),
  note TEXT,
  logged_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_clients_stage ON clients(stage_id);
CREATE INDEX IF NOT EXISTS idx_partners_stage ON partners(stage_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_id);
