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

// Strips spaces/dashes/parens so "0400 000 000" and "0400-000-000" compare
// equal -- a dedupe heuristic, not full phone-number parsing.
function normalizePhone(phone) {
  return phone ? phone.replace(/[\s\-()]/g, '') : null;
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

  // Re-running this script -- on the same file, or a file that overlaps a
  // prior run -- would otherwise silently create full duplicate clients.
  // Existing phones/emails are loaded once up front and checked per row.
  const { rows: existingRows } = await db.query('SELECT phone, email FROM clients');
  const existingPhones = new Set(existingRows.map((r) => normalizePhone(r.phone)).filter(Boolean));
  const existingEmails = new Set(existingRows.map((r) => (r.email || '').toLowerCase()).filter(Boolean));

  let imported = 0;
  let skipped = 0;
  let duplicates = 0;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const record of records) {
      const name = resolveField(record, COLUMN_MAP.name);
      if (!name) { skipped++; continue; }

      const phone = resolveField(record, COLUMN_MAP.phone);
      const email = resolveField(record, COLUMN_MAP.email);
      const normalizedPhone = normalizePhone(phone);
      const isDuplicate = (normalizedPhone && existingPhones.has(normalizedPhone))
        || (!normalizedPhone && email && existingEmails.has(email.toLowerCase()));
      if (isDuplicate) { duplicates++; continue; }

      if (!dryRun) {
        await client.query(
          `INSERT INTO clients (name, phone, email, budget_label, notes, stage_id, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'cold')`,
          [
            name,
            phone,
            email,
            resolveField(record, COLUMN_MAP.budget_label),
            resolveField(record, COLUMN_MAP.notes),
            firstStage.id,
          ]
        );
      }
      imported++;
      // Guards against duplicates *within* the same CSV too, not just
      // against what was already in the database -- matters for --dry-run
      // too, so the preview reflects what a real run would actually do.
      if (normalizedPhone) existingPhones.add(normalizedPhone);
      if (email) existingEmails.add(email.toLowerCase());
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
  console.log(`Skipped (already in the system, matched by phone or email): ${duplicates}`);
  if (dryRun) console.log('Re-run without --dry-run once COLUMN_MAP looks correct above.');

  await db.pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
