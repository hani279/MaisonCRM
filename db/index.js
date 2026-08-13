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
  'Negotiation / Auction Bidding',
  'Contract Exchange',
  'Cooling-off / Unconditional',
  'Pre-Settlement Inspection',
  'Settlement',
];

// Migration for databases seeded before these stages were removed. Any client
// still sitting on a removed stage is moved to the nearest surviving stage
// (forward first, since their progress shouldn't regress; back only if the
// removed stage was the last one) — then remaining positions are renumbered
// contiguously so Back/Next navigation stays correct. Safe to run every boot:
// it's a no-op once the named stages no longer exist.
function migrateRemoveClientStages(names) {
  const placeholders = names.map(() => '?').join(',');
  const toRemove = db
    .prepare(`SELECT id, position FROM pipeline_stages WHERE pipeline = 'client' AND name IN (${placeholders})`)
    .all(...names);
  if (toRemove.length === 0) return;

  const removeIds = toRemove.map((s) => s.id);
  const idPlaceholders = removeIds.map(() => '?').join(',');

  const run = db.transaction(() => {
    for (const stage of toRemove) {
      const forward = db
        .prepare(
          `SELECT id FROM pipeline_stages
           WHERE pipeline = 'client' AND position > ? AND id NOT IN (${idPlaceholders})
           ORDER BY position ASC LIMIT 1`
        )
        .get(stage.position, ...removeIds);
      const backward = db
        .prepare(
          `SELECT id FROM pipeline_stages
           WHERE pipeline = 'client' AND position < ? AND id NOT IN (${idPlaceholders})
           ORDER BY position DESC LIMIT 1`
        )
        .get(stage.position, ...removeIds);
      const fallback = forward || backward;

      if (fallback) {
        db.prepare('UPDATE clients SET stage_id = ? WHERE stage_id = ?').run(fallback.id, stage.id);
      }
      db.prepare('DELETE FROM pipeline_stages WHERE id = ?').run(stage.id);
    }

    const remaining = db
      .prepare("SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position ASC")
      .all();
    const renumber = db.prepare('UPDATE pipeline_stages SET position = ? WHERE id = ?');
    remaining.forEach((s, i) => renumber.run(i + 1, s.id));
  });

  run();
}

migrateRemoveClientStages(['Valuation & Pricing Analysis', 'Finance Finalisation', 'Handover']);

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
// already-in-use database, since each seed function is separately gated by both
// the env var and an empty table. See db/seed-demo.js for what these insert.
if (process.env.DEMO_SEED === 'true') {
  const { seedDemoData, seedDemoUser } = require('./seed-demo');
  seedDemoUser(db);
  seedDemoData(db);
}

module.exports = db;
