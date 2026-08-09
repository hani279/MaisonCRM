// Copies data/maisons.db into backups/ with a timestamped filename.
// Run manually (npm run backup) or wire up to a scheduled task (e.g. cron, Task Scheduler).
// This is a local safety net in addition to pointing data/ at a OneDrive-synced folder.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');
const DB_PATH = path.join(DATA_DIR, 'maisons.db');

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database found at ${DB_PATH}. Run the app at least once first.`);
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(BACKUP_DIR, `maisons-${timestamp}.db`);

fs.copyFileSync(DB_PATH, dest);
console.log(`Backed up database to ${dest}`);
