const { Pool, types } = require('pg');

// node-postgres returns BIGINT (our id columns) as strings by default, to
// avoid precision loss above Number.MAX_SAFE_INTEGER. This CRM's row counts
// never get remotely close to that, and the frontend expects numeric ids
// (as it always got from SQLite's INTEGER PRIMARY KEY), so parse them as
// plain numbers instead of switching every id comparison in app.js to strings.
types.setTypeParser(20, (val) => parseInt(val, 10));

const rawSchema = process.env.PGSCHEMA || 'public';
if (!/^[a-z_][a-z0-9_]*$/.test(rawSchema)) {
  throw new Error(`Invalid PGSCHEMA "${rawSchema}"`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  // Startup-packet option, applied before this connection runs any query —
  // lets one codebase serve either the real app (public schema) or the demo
  // deployment (demo schema) via a single PGSCHEMA env var, with every
  // existing unqualified table name (clients, partners, ...) resolving
  // automatically to the right schema.
  options: `-c search_path=${rawSchema},public`,
  // Kept small on purpose: on Vercel this pool is created fresh per cold
  // serverless instance, and many of those can run concurrently — a large
  // per-instance pool would multiply out and exhaust Supabase's pooler
  // connection limit for what is otherwise a low-traffic internal CRM.
  max: 3,
});

async function query(text, params) {
  return pool.query(text, params);
}

module.exports = { pool, query, schema: rawSchema };
