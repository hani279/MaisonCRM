require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');

const CLIENT_STAGES = [
  'Initial Consultation',
  'Engagement & Agreement',
  'Brief Development',
  'Property Search',
  'Shortlisting & Inspections',
  'Due Diligence',
  'Negotiation / Auction Bidding',
  'Contract Exchange',
  'Cooling-off / Unconditional',
  'Pre-Settlement Inspection',
  'Settlement',
  'Lost',
];

const PARTNER_STAGES = [
  'New Contact',
  'Building Relationship',
  'Active Referrer',
  'Fee Pending',
  'Fee Paid',
];

async function seedStages(client, pipeline, names) {
  const { rows } = await client.query(
    'SELECT COUNT(*) AS c FROM pipeline_stages WHERE pipeline = $1',
    [pipeline]
  );
  if (Number(rows[0].c) > 0) {
    console.log(`  ${pipeline} stages already present, skipping seed.`);
    return;
  }
  for (let i = 0; i < names.length; i++) {
    await client.query(
      'INSERT INTO pipeline_stages (pipeline, name, position) VALUES ($1, $2, $3)',
      [pipeline, names[i], i + 1]
    );
  }
  console.log(`  seeded ${names.length} ${pipeline} stages.`);
}

// Backfills the users table (added after some deployments already had
// accounts) from Supabase Auth, and keeps it in sync if it's ever out of
// step. Auth is project-wide, not schema-scoped, so this only pulls in users
// tagged for the target schema — same filter routes/users.js uses.
async function syncUsers(client, targetSchema) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.log('  SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not set, skipping user sync.');
    return;
  }
  const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;

  const users = data.users.filter((u) => u.user_metadata && u.user_metadata.schema === targetSchema);
  for (const u of users) {
    await client.query(
      `INSERT INTO users (id, name, email, role)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, role = EXCLUDED.role`,
      [u.id, (u.user_metadata && u.user_metadata.name) || '', u.email, (u.user_metadata && u.user_metadata.role) || 'member']
    );
  }
  console.log(`  synced ${users.length} user(s) into "${targetSchema}".`);
}

async function main() {
  const targetSchema = process.argv[2];
  if (!targetSchema || !/^[a-z_][a-z0-9_]*$/.test(targetSchema)) {
    console.error('Usage: node scripts/init-supabase-schema.js <schema-name>');
    console.error('Example: node scripts/init-supabase-schema.js public');
    process.exit(1);
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${targetSchema}"`);
    await client.query(`SET search_path TO "${targetSchema}", public`);

    const schemaSql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await client.query(schemaSql);
    console.log(`Applied db/schema.sql to schema "${targetSchema}".`);

    await seedStages(client, 'client', CLIENT_STAGES);
    await seedStages(client, 'partner', PARTNER_STAGES);
    await syncUsers(client, targetSchema);

    console.log(`Done. Schema "${targetSchema}" is ready.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
