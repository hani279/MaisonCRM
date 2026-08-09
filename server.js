const path = require('path');
const express = require('express');
const db = require('./db');

const clientsRouter = require('./routes/clients');
const partnersRouter = require('./routes/partners');
const callsRouter = require('./routes/calls');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/stages', (req, res) => {
  const pipeline = req.query.pipeline === 'partner' ? 'partner' : 'client';
  const rows = db
    .prepare('SELECT * FROM pipeline_stages WHERE pipeline = ? ORDER BY position')
    .all(pipeline);
  res.json(rows);
});

app.use('/api/clients', clientsRouter);
app.use('/api/partners', partnersRouter);
app.use('/api', callsRouter);

app.listen(PORT, () => {
  console.log(`Maisons CRM running at http://localhost:${PORT}`);
});
