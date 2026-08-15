const express = require('express');
const db = require('../db');

const router = express.Router();

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

router.get('/', async (req, res) => {
  const { rows } = await db.query('SELECT * FROM labels ORDER BY name');
  res.json(rows);
});

router.post('/', async (req, res) => {
  const { name, color } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (color && !HEX_COLOR.test(color)) {
    return res.status(400).json({ error: 'color must be a hex value like #0071e3' });
  }

  try {
    const { rows } = await db.query(
      'INSERT INTO labels (name, color) VALUES ($1, $2) RETURNING *',
      [name.trim(), color || '#0071e3']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    throw err;
  }
});

router.patch('/:id', async (req, res) => {
  const { rows: existingRows } = await db.query('SELECT * FROM labels WHERE id = $1', [req.params.id]);
  const existing = existingRows[0];
  if (!existing) return res.status(404).json({ error: 'not found' });

  const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
  const color = req.body.color !== undefined ? req.body.color : existing.color;
  if (req.body.color !== undefined && !HEX_COLOR.test(color)) {
    return res.status(400).json({ error: 'color must be a hex value like #0071e3' });
  }

  try {
    const { rows } = await db.query(
      'UPDATE labels SET name = $1, color = $2 WHERE id = $3 RETURNING *',
      [name, color, req.params.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A label with that name already exists' });
    }
    throw err;
  }
});

router.delete('/:id', async (req, res) => {
  await db.query('DELETE FROM labels WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
