// One-time migration: copies real data out of the local SQLite file
// (data/maisons.db) into the Supabase "public" schema. Run with --dry-run
// first to review counts and stage-name mapping before writing anything.
//
//   npm install --save-dev better-sqlite3   (not a runtime dependency — only this script needs it)
//   node scripts/migrate-sqlite-to-supabase.js --dry-run
//   node scripts/migrate-sqlite-to-supabase.js
//
// Safe to re-run --dry-run as many times as you like. The real run should
// only be run once against an empty public schema (this script does not
// de-duplicate against existing rows).

require('dotenv').config();
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const DRY_RUN = process.argv.includes('--dry-run');
const SQLITE_PATH = path.join(__dirname, '..', 'data', 'maisons.db');

async function main() {
  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();
  await pg.query('SET search_path TO public');

  try {
    console.log(DRY_RUN ? '--- DRY RUN (no writes) ---' : '--- LIVE MIGRATION ---');

    // Stage IDs differ between the two databases — map by (pipeline, name).
    const pgStages = (await pg.query('SELECT id, pipeline, name FROM pipeline_stages')).rows;
    const stageIdByName = new Map(pgStages.map((s) => [`${s.pipeline}:${s.name}`, s.id]));

    const sqliteStages = sqlite.prepare('SELECT id, pipeline, name FROM pipeline_stages').all();
    const sqliteStageNameById = new Map(sqliteStages.map((s) => [s.id, `${s.pipeline}:${s.name}`]));

    const unmapped = sqliteStages.filter((s) => !stageIdByName.has(`${s.pipeline}:${s.name}`));
    if (unmapped.length > 0) {
      console.error('These SQLite stages have no matching name in the Supabase public schema:');
      unmapped.forEach((s) => console.error(`  [${s.pipeline}] ${s.name}`));
      throw new Error('Run scripts/init-supabase-schema.js public first, or reconcile stage names.');
    }
    console.log(`Stage mapping OK (${sqliteStages.length} stages matched by name).`);

    const partnerIdMap = new Map();
    const clientIdMap = new Map();
    const labelIdMap = new Map();

    // --- partners ---
    const partners = sqlite.prepare('SELECT * FROM partners').all();
    console.log(`partners: ${partners.length} rows`);
    for (const p of partners) {
      if (DRY_RUN) continue;
      const stageId = stageIdByName.get(sqliteStageNameById.get(p.stage_id));
      const { rows } = await pg.query(
        `INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [p.company_name, p.contact_name, p.mobile, p.email, p.notes, stageId, p.created_at, p.updated_at]
      );
      partnerIdMap.set(p.id, rows[0].id);
    }

    // --- clients ---
    const clients = sqlite.prepare('SELECT * FROM clients').all();
    console.log(`clients: ${clients.length} rows`);
    for (const c of clients) {
      if (DRY_RUN) continue;
      const stageId = stageIdByName.get(sqliteStageNameById.get(c.stage_id));
      const referredBy = c.referred_by_partner_id ? partnerIdMap.get(c.referred_by_partner_id) : null;
      const { rows } = await pg.query(
        `INSERT INTO clients
          (name, phone, email, budget_label, stage_id, status, next_action_label, next_action_date,
           referred_by_partner_id, referral_fee_note, notes, archived_at, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          c.name, c.phone, c.email, c.budget_label, stageId, c.status,
          c.next_action_label, c.next_action_date, referredBy, c.referral_fee_note, c.notes,
          c.archived_at, c.created_at, c.updated_at,
        ]
      );
      clientIdMap.set(c.id, rows[0].id);
    }

    // --- call_logs ---
    const callLogs = sqlite.prepare('SELECT * FROM call_logs').all();
    console.log(`call_logs: ${callLogs.length} rows`);
    for (const cl of callLogs) {
      if (DRY_RUN) continue;
      const clientId = clientIdMap.get(cl.client_id);
      if (!clientId) continue;
      await pg.query(
        `INSERT INTO call_logs (client_id, type, note, logged_at, created_at) VALUES ($1,$2,$3,$4,$5)`,
        [clientId, cl.type, cl.note, cl.logged_at, cl.created_at]
      );
    }

    // --- labels ---
    const labels = sqlite.prepare('SELECT * FROM labels').all();
    console.log(`labels: ${labels.length} rows`);
    for (const l of labels) {
      if (DRY_RUN) continue;
      const { rows } = await pg.query(
        `INSERT INTO labels (name, color, created_at) VALUES ($1,$2,$3) RETURNING id`,
        [l.name, l.color, l.created_at]
      );
      labelIdMap.set(l.id, rows[0].id);
    }

    // --- client_labels / partner_labels ---
    const clientLabels = sqlite.prepare('SELECT * FROM client_labels').all();
    console.log(`client_labels: ${clientLabels.length} rows`);
    for (const cl of clientLabels) {
      if (DRY_RUN) continue;
      const clientId = clientIdMap.get(cl.client_id);
      const labelId = labelIdMap.get(cl.label_id);
      if (!clientId || !labelId) continue;
      await pg.query(
        'INSERT INTO client_labels (client_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [clientId, labelId]
      );
    }

    const partnerLabels = sqlite.prepare('SELECT * FROM partner_labels').all();
    console.log(`partner_labels: ${partnerLabels.length} rows`);
    for (const pl of partnerLabels) {
      if (DRY_RUN) continue;
      const partnerId = partnerIdMap.get(pl.partner_id);
      const labelId = labelIdMap.get(pl.label_id);
      if (!partnerId || !labelId) continue;
      await pg.query(
        'INSERT INTO partner_labels (partner_id, label_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [partnerId, labelId]
      );
    }

    if (DRY_RUN) {
      console.log('\nDry run complete — nothing was written. Re-run without --dry-run to migrate for real.');
    } else {
      const counts = await pg.query(`
        SELECT
          (SELECT COUNT(*) FROM partners) AS partners,
          (SELECT COUNT(*) FROM clients) AS clients,
          (SELECT COUNT(*) FROM call_logs) AS call_logs,
          (SELECT COUNT(*) FROM labels) AS labels,
          (SELECT COUNT(*) FROM client_labels) AS client_labels,
          (SELECT COUNT(*) FROM partner_labels) AS partner_labels
      `);
      console.log('\nMigration complete. Supabase public schema now has:');
      console.log(counts.rows[0]);
    }
  } finally {
    sqlite.close();
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
