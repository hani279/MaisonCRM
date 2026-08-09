const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/clients/:clientId/calls', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM call_logs WHERE client_id = ? ORDER BY logged_at DESC, id DESC')
    .all(req.params.clientId);
  res.json(rows);
});

router.post('/clients/:clientId/calls', (req, res) => {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(req.params.clientId);
  if (!client) return res.status(404).json({ error: 'client not found' });

  const { type, note, logged_at } = req.body;
  if (!['call', 'text', 'voicemail'].includes(type)) {
    return res.status(400).json({ error: 'type must be call, text, or voicemail' });
  }

  const info = db
    .prepare(
      `INSERT INTO call_logs (client_id, type, note, logged_at)
       VALUES (?, ?, ?, COALESCE(?, datetime('now')))`
    )
    .run(req.params.clientId, type, note || null, logged_at || null);

  const created = db.prepare('SELECT * FROM call_logs WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(created);
});

router.delete('/calls/:id', (req, res) => {
  db.prepare('DELETE FROM call_logs WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
