// Dumps the Supabase "public" schema (the real app's data) into backups/
// with a timestamped filename, using pg_dump.
// Run manually (npm run backup) or wire up to a scheduled task (cron, Task Scheduler).

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BACKUP_DIR = path.join(__dirname, '..', 'backups');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set — check your .env file.');
  process.exit(1);
}

try {
  execFileSync('pg_dump', ['--version'], { stdio: 'ignore' });
} catch {
  console.error(
    'pg_dump was not found on this machine. Install the Postgres client tools first, e.g.:\n' +
    '  brew install libpq && echo \'export PATH="/opt/homebrew/opt/libpq/bin:$PATH"\' >> ~/.zshrc\n' +
    'then open a new terminal and try again.'
  );
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = path.join(BACKUP_DIR, `maisons-${timestamp}.sql`);

execFileSync('pg_dump', [process.env.DATABASE_URL, '--schema=public', '--no-owner', '--no-privileges', '-f', dest]);
console.log(`Backed up database to ${dest}`);
