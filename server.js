const path = require('path');
const express = require('express');
const db = require('./db');

const clientsRouter = require('./routes/clients');
const partnersRouter = require('./routes/partners');
const callsRouter = require('./routes/calls');
const importRouter = require('./routes/import');
const settingsRouter = require('./routes/settings');

const app = express();
const PORT = process.env.PORT || 4000;

// A large GoHighLevel-style CSV pasted as JSON text can exceed the 100kb default.
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (req, res) => {
  res.json({ demo: process.env.DEMO_SEED === 'true' });
});

app.get('/api/stages', (req, res) => {
  const pipeline = req.query.pipeline === 'partner' ? 'partner' : 'client';
  const rows = db
    .prepare('SELECT * FROM pipeline_stages WHERE pipeline = ? ORDER BY position')
    .all(pipeline);
  res.json(rows);
});

app.use('/api/clients/import', importRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/clients', clientsRouter);
app.use('/api/partners', partnersRouter);
app.use('/api', callsRouter);

app.listen(PORT, () => {
  console.log(`Maisons CRM running at http://localhost:${PORT}`);
});
