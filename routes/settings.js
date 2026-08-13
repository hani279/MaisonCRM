const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');

const router = express.Router();

function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO app_settings (key, value) VALUES (@key, @value)
     ON CONFLICT(key) DO UPDATE SET value = @value`
  ).run({ key, value });
}

function currentSettings() {
  return {
    backupFolder: getSetting('backup_folder', ''),
    lastBackupAt: getSetting('last_backup_at', null),
  };
}

router.get('/', (req, res) => {
  res.json(currentSettings());
});

router.put('/', (req, res) => {
  if (typeof req.body.backupFolder === 'string') {
    setSetting('backup_folder', req.body.backupFolder.trim());
  }
  res.json(currentSettings());
});

router.post('/backup', async (req, res) => {
  const folder = getSetting('backup_folder', '');
  if (!folder) {
    return res.status(400).json({ error: 'Set a backup folder first.' });
  }

  let stat;
  try {
    stat = fs.statSync(folder);
  } catch {
    return res.status(400).json({ error: `That folder doesn't exist: ${folder}` });
  }
  if (!stat.isDirectory()) {
    return res.status(400).json({ error: `That path isn't a folder: ${folder}` });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(folder, `maisons-${timestamp}.db`);

  try {
    await db.backup(dest);
  } catch (err) {
    return res.status(500).json({ error: `Backup failed: ${err.message}` });
  }

  const now = db.prepare("SELECT datetime('now') AS now").get().now;
  setSetting('last_backup_at', now);
  res.json({ ok: true, path: dest, ...currentSettings() });
});

module.exports = router;
