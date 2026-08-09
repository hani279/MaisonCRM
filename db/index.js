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

module.exports = db;
