const express = require('express');
const db = require('../db');

const router = express.Router();

router.get('/clients/:clientId/calls', async (req, res) => {
  const { rows } = await db.query(
    'SELECT * FROM call_logs WHERE client_id = $1 ORDER BY logged_at DESC, id DESC',
    [req.params.clientId]
  );
  res.json(rows);
});

router.post('/clients/:clientId/calls', async (req, res) => {
  const { rows: clientRows } = await db.query('SELECT id FROM clients WHERE id = $1', [req.params.clientId]);
  if (!clientRows[0]) return res.status(404).json({ error: 'client not found' });

  const { type, note, logged_at } = req.body;
  if (!['call', 'text', 'voicemail'].includes(type)) {
    return res.status(400).json({ error: 'type must be call, text, or voicemail' });
  }

  const { rows } = await db.query(
    `INSERT INTO call_logs (client_id, type, note, logged_at)
     VALUES ($1, $2, $3, COALESCE($4, now()))
     RETURNING *`,
    [req.params.clientId, type, note || null, logged_at || null]
  );

  res.status(201).json(rows[0]);
});

router.delete('/calls/:id', async (req, res) => {
  await db.query('DELETE FROM call_logs WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
