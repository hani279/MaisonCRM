// Sets up demo support for the Supabase-backed app:
//   1. Creates/replaces a demo.demo_reset() Postgres function holding the
//      fictional dataset — truncates the demo schema's data tables and
//      reseeds them. Called by POST /api/demo/reset and (if you enable
//      pg_cron in the Supabase dashboard) on a schedule, so the demo keeps
//      cleaning itself up the way the old SQLite-based demo did.
//   2. Runs it once now, to populate the demo schema for the first time.
//   3. Ensures the permanent demo login (demo@maisons.example / demo1234)
//      exists in Supabase Auth. This step is idempotent and only ever
//      touches that one fixed account.
//
//   node scripts/seed-demo-supabase.js
//
// To keep the demo self-cleaning automatically, enable the pg_cron
// extension in the Supabase dashboard (Database -> Extensions -> pg_cron),
// then run once in the SQL editor:
//   select cron.schedule('demo-reset', '0 */6 * * *', 'select demo.demo_reset()');

require('dotenv').config();
const { Client } = require('pg');
const supabaseAdmin = require('../db/supabaseAdmin');

const DEMO_RESET_FUNCTION_SQL = `
CREATE OR REPLACE FUNCTION demo.demo_reset()
RETURNS void
LANGUAGE plpgsql
SET search_path = demo, public
AS $$
DECLARE
  v_horizon_id bigint;
  v_sydney_id bigint;
BEGIN
  TRUNCATE client_labels, partner_labels, call_logs, clients, partners RESTART IDENTITY CASCADE;

  INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id)
  VALUES ('Horizon Finance Group', 'Priya Sharma', '0412 555 101', 'priya@horizonfinance.example',
          'Mortgage broker — sends a couple of referrals most months.',
          (SELECT id FROM pipeline_stages WHERE pipeline = 'partner' AND position = 3))
  RETURNING id INTO v_horizon_id;

  INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id)
  VALUES ('Sydney Settlements Co', 'Marcus Bell', '0433 222 909', 'marcus@sydneysettlements.example',
          'Conveyancer — handles most of our contract reviews.',
          (SELECT id FROM pipeline_stages WHERE pipeline = 'partner' AND position = 5))
  RETURNING id INTO v_sydney_id;

  INSERT INTO clients (name, phone, email, budget_label, stage_id, status, next_action_label, next_action_date, referred_by_partner_id, referral_fee_note, notes, archived_at)
  VALUES
    ('Emma Chen', '0401 234 111', 'emma.chen@example.com', '$650,000 - $750,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=1), 'cold',
      NULL, NULL, NULL, NULL, 'First-time buyer, still exploring suburbs.', NULL),
    ('Liam Bennett', '0401 234 112', 'liam.bennett@example.com', '$800,000 - $900,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=2), 'engaged',
      'Send engagement agreement', (now() + interval '2 days')::date, NULL, NULL, NULL, NULL),
    ('Sophie Nguyen', '0401 234 113', 'sophie.nguyen@example.com', '$700,000 - $780,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=3), 'engaged',
      NULL, NULL, v_horizon_id, '15% of commission', NULL, NULL),
    ('Jack Thompson', '0401 234 114', 'jack.thompson@example.com', '$900,000 - $1,000,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=4), 'active',
      NULL, NULL, NULL, NULL, NULL, NULL),
    ('Ava Patel', '0401 234 115', 'ava.patel@example.com', '$1,100,000+',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=5), 'active',
      'Book Saturday inspections', (now() + interval '1 days')::date, NULL, NULL, NULL, NULL),
    ('Noah Williams', '0401 234 116', 'noah.williams@example.com', '$620,000 - $680,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=6), 'engaged',
      NULL, NULL, NULL, NULL, NULL, NULL),
    ('Oliver Kim', '0401 234 118', 'oliver.kim@example.com', '$950,000 - $1,050,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=7), 'active',
      'Attend Saturday auction', (now() + interval '3 days')::date, v_horizon_id, '15% of commission', NULL, NULL),
    ('Mia Anderson', '0401 234 119', 'mia.anderson@example.com', '$700,000 - $760,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=8), 'engaged',
      NULL, NULL, NULL, NULL, NULL, NULL),
    ('Charlotte Lee', '0401 234 121', 'charlotte.lee@example.com', '$1,200,000+',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=8), 'engaged',
      NULL, NULL, v_sydney_id, 'Flat $500 referral fee', NULL, NULL),
    ('Lucas Martin', '0401 234 120', 'lucas.martin@example.com', '$680,000 - $740,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=9), 'engaged',
      'Confirm building & pest results', (now() + interval '2 days')::date, NULL, NULL, NULL, NULL),
    ('Henry Davies', '0401 234 122', 'henry.davies@example.com', '$820,000 - $890,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=10), 'settled',
      'Final walkthrough', (now() + interval '4 days')::date, NULL, NULL, NULL, NULL),
    ('Grace Wilson', '0401 234 123', 'grace.wilson@example.com', '$730,000 - $790,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=11), 'settled',
      NULL, NULL, NULL, NULL, NULL, NULL),
    ('Ethan Brown', '0401 234 124', 'ethan.brown@example.com', '$880,000 - $940,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=11), 'settled',
      NULL, NULL, NULL, NULL, 'Settled two weeks ago — a great one to show off the Completed view.', NULL),
    ('Ryan Foster', '0401 234 126', 'ryan.foster@example.com', '$600,000 - $650,000',
      (SELECT id FROM pipeline_stages WHERE pipeline='client' AND position=1), 'lost',
      NULL, NULL, NULL, NULL, 'Paused their search indefinitely.', now() - interval '240 hours');

  INSERT INTO call_logs (client_id, type, note, logged_at)
  SELECT id, 'call', 'Discussed budget flexibility.', now() - interval '48 hours' FROM clients WHERE name = 'Liam Bennett'
  UNION ALL
  SELECT id, 'text', 'Confirmed Saturday inspection times.', now() - interval '5 hours' FROM clients WHERE name = 'Ava Patel'
  UNION ALL
  SELECT id, 'voicemail', 'Left a message about auction strategy.', now() - interval '26 hours' FROM clients WHERE name = 'Oliver Kim'
  UNION ALL
  SELECT id, 'call', 'Ran through the pre-settlement checklist.', now() - interval '20 hours' FROM clients WHERE name = 'Henry Davies';
END;
$$;
`;

async function ensureDemoUser(pg) {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const existing = data.users.find((u) => u.email === 'demo@maisons.example');
  if (!existing) {
    const { error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: 'demo@maisons.example',
      password: 'demo1234',
      email_confirm: true,
      user_metadata: { name: 'Demo Admin', role: 'admin', schema: 'demo' },
    });
    if (createError) throw createError;
    console.log('Created demo login: demo@maisons.example / demo1234');
  } else {
    console.log('Demo login already exists, leaving it as-is.');
  }

  // Marks the demo schema's own app_meta as "set up" — see routes/auth.js for why
  // this can't just be inferred from the (project-wide) Supabase Auth user list.
  await pg.query(
    "INSERT INTO demo.app_meta (key, value) VALUES ('admin_created', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  );
}

async function main() {
  const pg = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pg.connect();

  try {
    await pg.query('CREATE SCHEMA IF NOT EXISTS demo');
    await pg.query(DEMO_RESET_FUNCTION_SQL);
    console.log('demo.demo_reset() function created/updated.');

    await pg.query('SELECT demo.demo_reset()');
    console.log('Demo schema seeded.');

    await ensureDemoUser(pg);
  } finally {
    await pg.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
