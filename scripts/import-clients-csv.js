// One-off migration: import the ~900-contact GoHighLevel CSV export into the CRM.
//
// Usage:
//   node scripts/import-clients-csv.js path/to/gohighlevel-export.csv
//   node scripts/import-clients-csv.js path/to/gohighlevel-export.csv --dry-run
//
// GoHighLevel's exact export header names aren't known ahead of time, so edit
// COLUMN_MAP below to match your actual CSV's header row before running for real.
// Run with --dry-run first to preview what would be imported without writing anything.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { parseCsv } = require('../lib/csv');

// Map our CRM fields -> CSV header name(s). If an array is given, the first
// non-empty match wins (handy for "Name" vs separate "First Name"/"Last Name").
const COLUMN_MAP = {
  name: ['Name', 'Full Name', ['First Name', 'Last Name']],
  phone: ['Phone', 'Phone Number', 'Mobile'],
  email: ['Email', 'Email Address'],
  budget_label: ['Budget', 'Price Range'],
  notes: ['Notes', 'Note'],
};

function resolveField(record, mapping) {
  for (const source of mapping) {
    if (Array.isArray(source)) {
      const combined = source.map((h) => record[h]).filter(Boolean).join(' ').trim();
      if (combined) return combined;
    } else if (record[source]) {
      return record[source].trim();
    }
  }
  return null;
}

async function main() {
  const filePath = process.argv[2];
  const dryRun = process.argv.includes('--dry-run');

  if (!filePath) {
    console.error('Usage: node scripts/import-clients-csv.js <path-to-csv> [--dry-run]');
    process.exit(1);
  }

  const text = fs.readFileSync(path.resolve(filePath), 'utf8');
  const records = parseCsv(text);
  console.log(`Parsed ${records.length} rows from ${filePath}`);
  if (records.length > 0) {
    console.log('CSV headers found:', Object.keys(records[0]).join(', '));
  }

  const { rows: stageRows } = await db.query(
    "SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position LIMIT 1"
  );
  const firstStage = stageRows[0];
  if (!firstStage) {
    console.error('No client stages are configured — run scripts/init-supabase-schema.js first.');
    process.exit(1);
  }

  let imported = 0;
  let skipped = 0;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      const name = resolveField(record, COLUMN_MAP.name);
      if (!name) { skipped++; continue; }

      if (!dryRun) {
        await client.query(
          `INSERT INTO clients (name, phone, email, budget_label, notes, stage_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'cold')`,
          [
            name,
            resolveField(record, COLUMN_MAP.phone),
            resolveField(record, COLUMN_MAP.email),
            resolveField(record, COLUMN_MAP.budget_label),
            resolveField(record, COLUMN_MAP.notes),
            firstStage.id,
          ]
        );
      }
      imported++;
    }
    if (dryRun) await client.query('ROLLBACK');
    else await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`${dryRun ? '[dry run] Would import' : 'Imported'}: ${imported}`);
  console.log(`Skipped (no name found): ${skipped}`);
  if (dryRun) console.log('Re-run without --dry-run once COLUMN_MAP looks correct above.');

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
