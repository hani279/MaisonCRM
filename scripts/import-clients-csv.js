// One-off migration: import the ~900-contact GoHighLevel CSV export into the CRM.
//
// Usage:
//   node scripts/import-clients-csv.js path/to/gohighlevel-export.csv
//   node scripts/import-clients-csv.js path/to/gohighlevel-export.csv --dry-run
//
// GoHighLevel's exact export header names aren't known ahead of time, so edit
// COLUMN_MAP below to match your actual CSV's header row before running for real.
// Run with --dry-run first to preview what would be imported without writing anything.

const fs = require('fs');
const path = require('path');
const db = require('../db');

// Map our CRM fields -> CSV header name(s). If an array is given, the first
// non-empty match wins (handy for "Name" vs separate "First Name"/"Last Name").
const COLUMN_MAP = {
  name: ['Name', 'Full Name', ['First Name', 'Last Name']],
  phone: ['Phone', 'Phone Number', 'Mobile'],
  email: ['Email', 'Email Address'],
  budget_label: ['Budget', 'Price Range'],
  notes: ['Notes', 'Note'],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c === '\r') {
      // skip, \n handles the row break
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }

  const header = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.some((v) => v && v.trim()))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] || '').trim()])));
}

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

function main() {
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

  const firstStage = db
    .prepare("SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position LIMIT 1")
    .get();

  const insert = db.prepare(`
    INSERT INTO clients (name, phone, email, budget_label, notes, stage_id, status)
    VALUES (@name, @phone, @email, @budget_label, @notes, @stage_id, 'cold')
  `);

  let imported = 0;
  let skipped = 0;

  const runImport = db.transaction((rows) => {
    for (const record of rows) {
      const name = resolveField(record, COLUMN_MAP.name);
      if (!name) { skipped++; continue; }

      const payload = {
        name,
        phone: resolveField(record, COLUMN_MAP.phone),
        email: resolveField(record, COLUMN_MAP.email),
        budget_label: resolveField(record, COLUMN_MAP.budget_label),
        notes: resolveField(record, COLUMN_MAP.notes),
        stage_id: firstStage.id,
      };

      if (!dryRun) insert.run(payload);
      imported++;
    }
  });

  runImport(records);

  console.log(`${dryRun ? '[dry run] Would import' : 'Imported'}: ${imported}`);
  console.log(`Skipped (no name found): ${skipped}`);
  if (dryRun) console.log('Re-run without --dry-run once COLUMN_MAP looks correct above.');
}

main();
