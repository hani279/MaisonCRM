const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'maisons.db');
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// Migration for databases created before archiving existed.
ensureColumn('clients', 'archived_at', 'TEXT DEFAULT NULL');

const CLIENT_STAGES = [
  'Initial Consultation',
  'Engagement & Agreement',
  'Brief Development',
  'Property Search',
  'Shortlisting & Inspections',
  'Due Diligence',
  'Valuation & Pricing Analysis',
  'Negotiation / Auction Bidding',
  'Contract Exchange',
  'Cooling-off / Unconditional',
  'Finance Finalisation',
  'Pre-Settlement Inspection',
  'Settlement',
  'Handover',
];

const PARTNER_STAGES = [
  'New Contact',
  'Building Relationship',
  'Active Referrer',
  'Fee Pending',
  'Fee Paid',
];

function seedStages(pipeline, names) {
  const count = db
    .prepare('SELECT COUNT(*) AS c FROM pipeline_stages WHERE pipeline = ?')
    .get(pipeline).c;
  if (count > 0) return;
  const insert = db.prepare(
    'INSERT INTO pipeline_stages (pipeline, name, position) VALUES (?, ?, ?)'
  );
  const insertMany = db.transaction((rows) => {
    rows.forEach((name, i) => insert.run(pipeline, name, i + 1));
  });
  insertMany(names);
}

seedStages('client', CLIENT_STAGES);
seedStages('partner', PARTNER_STAGES);

// Demo deployments only (Render's DEMO_SEED=true) — never runs against a real,
// already-in-use database, since it's gated by both the env var and an empty
// clients table. See db/seed-demo.js for what it inserts.
if (process.env.DEMO_SEED === 'true') {
  require('./seed-demo').seedDemoData(db);
}

module.exports = db;
