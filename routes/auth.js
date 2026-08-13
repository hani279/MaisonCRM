const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

router.get('/status', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count === 0) {
    return res.json({ needsSetup: true, authenticated: false, user: null });
  }

  if (req.session && req.session.userId) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
    if (user) return res.json({ needsSetup: false, authenticated: true, user: publicUser(user) });
  }

  res.json({ needsSetup: false, authenticated: false, user: null });
});

router.post('/setup', (req, res) => {
  const count = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (count > 0) {
    return res.status(403).json({ error: 'Setup has already been completed.' });
  }

  const { name, email, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run(name.trim(), email.trim().toLowerCase(), hash, 'admin');

  req.session.userId = info.lastInsertRowid;
  req.session.role = 'admin';

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(publicUser(user));
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').trim().toLowerCase());

  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  req.session.userId = user.id;
  req.session.role = user.role;
  res.json(publicUser(user));
});

router.post('/logout', (req, res) => {
  if (!req.session) return res.status(204).end();
  req.session.destroy(() => res.status(204).end());
});

router.patch('/profile', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
  const email = req.body.email !== undefined ? req.body.email.trim().toLowerCase() : existing.email;

  if (!name) return res.status(400).json({ error: 'Name is required.' });
  if (!email) return res.status(400).json({ error: 'Email is required.' });

  let passwordHash = existing.password_hash;
  if (req.body.password) {
    if (req.body.password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    passwordHash = bcrypt.hashSync(req.body.password, 10);
  }

  try {
    db.prepare('UPDATE users SET name = ?, email = ?, password_hash = ? WHERE id = ?')
      .run(name, email, passwordHash, req.session.userId);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'That email is already in use.' });
    }
    throw err;
  }

  req.session.role = existing.role;
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.json(publicUser(updated));
});

module.exports = router;
