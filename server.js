const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const db = require('./db');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const clientsRouter = require('./routes/clients');
const partnersRouter = require('./routes/partners');
const callsRouter = require('./routes/calls');
const importRouter = require('./routes/import');
const labelsRouter = require('./routes/labels');

const app = express();
const PORT = process.env.PORT || 4000;

// A large GoHighLevel-style CSV pasted as JSON text can exceed the 100kb default.
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Behind Render's proxy, this lets express-session's cookie:{secure:'auto'} correctly
// detect HTTPS. A fresh random secret each boot means restarting the server signs
// everyone out — an acceptable, simple tradeoff for a small local/demo app.
app.set('trust proxy', 1);
app.use(session({
  secret: crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: 'auto',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days, refreshed on activity
  },
}));

// Public — must be reachable before a session exists.
app.use('/api/auth', authRouter);
app.get('/api/meta', (req, res) => {
  res.json({ demo: process.env.DEMO_SEED === 'true' });
});

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Admin access required' });
}

// Everything registered below this line requires a signed-in session.
app.use('/api', requireAuth);

app.get('/api/stages', (req, res) => {
  const pipeline = req.query.pipeline === 'partner' ? 'partner' : 'client';
  const rows = db
    .prepare('SELECT * FROM pipeline_stages WHERE pipeline = ? ORDER BY position')
    .all(pipeline);
  res.json(rows);
});

app.use('/api/users', requireAdmin, usersRouter);
app.use('/api/clients/import', importRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/partners', partnersRouter);
app.use('/api', callsRouter);

app.listen(PORT, () => {
  console.log(`Maisons CRM running at http://localhost:${PORT}`);
});
