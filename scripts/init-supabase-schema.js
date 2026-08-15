require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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

    console.log(`Done. Schema "${targetSchema}" is ready.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
