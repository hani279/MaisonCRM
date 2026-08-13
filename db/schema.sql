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
  archived_at TEXT DEFAULT NULL,
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

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#0071e3',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS client_labels (
  client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, label_id)
);

CREATE TABLE IF NOT EXISTS partner_labels (
  partner_id INTEGER NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (partner_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_clients_stage ON clients(stage_id);
CREATE INDEX IF NOT EXISTS idx_partners_stage ON partners(stage_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_client ON call_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_client_labels_label ON client_labels(label_id);
CREATE INDEX IF NOT EXISTS idx_partner_labels_label ON partner_labels(label_id);
