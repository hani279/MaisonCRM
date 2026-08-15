require('dotenv').config();
require('express-async-errors');
const path = require('path');
const express = require('express');
const db = require('./db');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const clientsRouter = require('./routes/clients');
const partnersRouter = require('./routes/partners');
const callsRouter = require('./routes/calls');
const importRouter = require('./routes/import');
const labelsRouter = require('./routes/labels');
const { requireAuth, requireAdmin } = require('./middleware/requireAuth');

const app = express();
const PORT = process.env.PORT || 4000;

// A large GoHighLevel-style CSV pasted as JSON text can exceed the 100kb default.
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Public — reachable before sign-in. Both are safe to expose: the anon key
// is meant for the browser, and it's paired with RLS denying it any access
// to the actual data tables (see db/schema.sql).
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  });
});
app.get('/api/meta', (req, res) => {
  res.json({ demo: db.schema === 'demo' });
});
app.use('/api/auth', authRouter);

// Everything registered below this line requires a valid Supabase session.
app.use('/api', requireAuth);

app.get('/api/stages', async (req, res) => {
  const pipeline = req.query.pipeline === 'partner' ? 'partner' : 'client';
  const { rows } = await db.query(
    'SELECT * FROM pipeline_stages WHERE pipeline = $1 ORDER BY position',
    [pipeline]
  );
  res.json(rows);
});

app.use('/api/users', requireAdmin, usersRouter);
app.use('/api/clients/import', importRouter);
app.use('/api/labels', labelsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/partners', partnersRouter);
app.use('/api', callsRouter);

if (db.schema === 'demo') {
  app.post('/api/demo/reset', requireAdmin, async (req, res) => {
    await db.query('SELECT demo.demo_reset()');
    res.status(204).end();
  });
}

// express-async-errors forwards thrown/rejected errors from the async
// handlers above here instead of leaving the request hanging.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

// On Vercel this file is required by api/index.js as a serverless function
// and never calls listen() itself — Vercel invokes the exported app per
// request. Locally (npm start) it's run directly, so it needs the listener.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Maisons CRM running at http://localhost:${PORT} (schema: ${db.schema})`);
  });
}

module.exports = app;
