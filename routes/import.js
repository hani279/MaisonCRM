const express = require('express');
const db = require('../db');
const { parseCsv } = require('../lib/csv');

const router = express.Router();

const TEMPLATE_CSV =
  'Name,Phone,Email,Budget,Notes\n' +
  'Jane Smith,0400 000 000,jane@example.com,"$600,000 - $700,000",Referred by a friend\n';

router.get('/template.csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="maisons-crm-client-import-template.csv"');
  res.send(TEMPLATE_CSV);
});

function guessColumn(headers, keywords) {
  const lower = headers.map((h) => h.toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h) => h.includes(kw));
    if (idx !== -1) return headers[idx];
  }
  return '';
}

router.post('/parse', (req, res) => {
  const { csvText } = req.body;
  if (!csvText || !csvText.trim()) {
    return res.status(400).json({ error: 'csvText is required' });
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return res.status(400).json({ error: 'No data rows found in that CSV.' });
  }

  const headers = Object.keys(rows[0]);
  const suggested = {
    nameCol: guessColumn(headers, ['first name', 'full name', 'name']),
    lastNameCol: guessColumn(headers, ['last name', 'surname']),
    phoneCol: guessColumn(headers, ['phone', 'mobile']),
    emailCol: guessColumn(headers, ['email']),
    budgetCol: guessColumn(headers, ['budget', 'price']),
    notesCol: guessColumn(headers, ['note']),
  };
  // If there's a real "Last Name" column, prefer "First Name" over a generic "Name" for the primary field.
  if (suggested.lastNameCol) {
    const firstNameGuess = guessColumn(headers, ['first name']);
    if (firstNameGuess) suggested.nameCol = firstNameGuess;
  }

  res.json({
    headers,
    rowCount: rows.length,
    sampleRows: rows.slice(0, 5),
    suggested,
  });
});

router.post('/commit', async (req, res) => {
  const { csvText, map } = req.body;
  if (!csvText || !map) {
    return res.status(400).json({ error: 'csvText and map are required' });
  }
  if (!map.nameCol && !map.lastNameCol) {
    return res.status(400).json({ error: 'Map at least a name column before importing.' });
  }

  const rows = parseCsv(csvText);

  const { rows: stageRows } = await db.query(
    "SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position LIMIT 1"
  );
  const firstStage = stageRows[0];
  if (!firstStage) {
    return res.status(500).json({ error: 'No client stages are configured.' });
  }

  const pick = (row, col) => (col && row[col] ? row[col].trim() : '') || null;

  let imported = 0;
  let skipped = 0;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const row of rows) {
      const first = map.nameCol ? (row[map.nameCol] || '').trim() : '';
      const last = map.lastNameCol ? (row[map.lastNameCol] || '').trim() : '';
      const name = [first, last].filter(Boolean).join(' ').trim();
      if (!name) { skipped++; continue; }

      await client.query(
        `INSERT INTO clients (name, phone, email, budget_label, notes, stage_id, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'cold')`,
        [name, pick(row, map.phoneCol), pick(row, map.emailCol), pick(row, map.budgetCol), pick(row, map.notesCol), firstStage.id]
      );
      imported++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.json({ imported, skipped });
});

module.exports = router;
