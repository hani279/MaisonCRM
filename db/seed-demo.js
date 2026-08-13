const bcrypt = require('bcryptjs');

// Demo login so a prospective purchaser can actually get into the demo deployment.
// Gated independently of seedDemoData's client check so it still runs even if
// clients somehow already exist — never runs against a real database, since
// DEMO_SEED is never set for Robert's local instance.
function seedDemoUser(db) {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (userCount > 0) return;

  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
    .run('Demo Admin', 'demo@maisons.example', hash, 'admin');
}

// Populates realistic-looking (entirely fictional) demo data for showcasing the
// app to a prospective purchaser. Only ever runs when DEMO_SEED=true is set in
// the environment, and only when the clients table is empty — so it can never
// touch or duplicate onto a real, already-in-use database (e.g. Robert's local
// data/maisons.db, which never sets that env var).
function seedDemoData(db) {
  const clientCount = db.prepare('SELECT COUNT(*) AS c FROM clients').get().c;
  if (clientCount > 0) return;

  const clientStages = db
    .prepare("SELECT id FROM pipeline_stages WHERE pipeline = 'client' ORDER BY position")
    .all();
  const partnerStages = db
    .prepare("SELECT id FROM pipeline_stages WHERE pipeline = 'partner' ORDER BY position")
    .all();

  const stageId = (position) => clientStages[position - 1].id;
  const partnerStageId = (position) => partnerStages[position - 1].id;

  const daysFromNow = (days) => {
    const d = new Date(Date.now() + days * 86400000);
    return d.toISOString().slice(0, 10);
  };
  const timeAgo = (hours) => {
    const d = new Date(Date.now() - hours * 3600000);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };

  const insertPartner = db.prepare(`
    INSERT INTO partners (company_name, contact_name, mobile, email, notes, stage_id)
    VALUES (@company_name, @contact_name, @mobile, @email, @notes, @stage_id)
  `);

  const horizonFinanceId = insertPartner.run({
    company_name: 'Horizon Finance Group',
    contact_name: 'Priya Sharma',
    mobile: '0412 555 101',
    email: 'priya@horizonfinance.example',
    notes: 'Mortgage broker — sends a couple of referrals most months.',
    stage_id: partnerStageId(3), // Active Referrer
  }).lastInsertRowid;

  const sydneySettlementsId = insertPartner.run({
    company_name: 'Sydney Settlements Co',
    contact_name: 'Marcus Bell',
    mobile: '0433 222 909',
    email: 'marcus@sydneysettlements.example',
    notes: 'Conveyancer — handles most of our contract reviews.',
    stage_id: partnerStageId(5), // Fee Paid
  }).lastInsertRowid;

  const insertClient = db.prepare(`
    INSERT INTO clients
      (name, phone, email, budget_label, stage_id, status,
       next_action_label, next_action_date, referred_by_partner_id, referral_fee_note,
       notes, archived_at)
    VALUES
      (@name, @phone, @email, @budget_label, @stage_id, @status,
       @next_action_label, @next_action_date, @referred_by_partner_id, @referral_fee_note,
       @notes, @archived_at)
  `);

  const demoClients = [
    { name: 'Emma Chen', phone: '0401 234 111', email: 'emma.chen@example.com', budget_label: '$650,000 - $750,000', stage: 1, status: 'cold', notes: 'First-time buyer, still exploring suburbs.' },
    { name: 'Liam Bennett', phone: '0401 234 112', email: 'liam.bennett@example.com', budget_label: '$800,000 - $900,000', stage: 2, status: 'engaged', next_action_label: 'Send engagement agreement', next_action_date: daysFromNow(2) },
    { name: 'Sophie Nguyen', phone: '0401 234 113', email: 'sophie.nguyen@example.com', budget_label: '$700,000 - $780,000', stage: 3, status: 'engaged', referred_by_partner_id: horizonFinanceId, referral_fee_note: '15% of commission' },
    { name: 'Jack Thompson', phone: '0401 234 114', email: 'jack.thompson@example.com', budget_label: '$900,000 - $1,000,000', stage: 4, status: 'active' },
    { name: 'Ava Patel', phone: '0401 234 115', email: 'ava.patel@example.com', budget_label: '$1,100,000+', stage: 5, status: 'active', next_action_label: 'Book Saturday inspections', next_action_date: daysFromNow(1) },
    { name: 'Noah Williams', phone: '0401 234 116', email: 'noah.williams@example.com', budget_label: '$620,000 - $680,000', stage: 6, status: 'engaged' },
    { name: 'Oliver Kim', phone: '0401 234 118', email: 'oliver.kim@example.com', budget_label: '$950,000 - $1,050,000', stage: 7, status: 'active', next_action_label: 'Attend Saturday auction', next_action_date: daysFromNow(3), referred_by_partner_id: horizonFinanceId, referral_fee_note: '15% of commission' },
    { name: 'Mia Anderson', phone: '0401 234 119', email: 'mia.anderson@example.com', budget_label: '$700,000 - $760,000', stage: 8, status: 'engaged' },
    { name: 'Charlotte Lee', phone: '0401 234 121', email: 'charlotte.lee@example.com', budget_label: '$1,200,000+', stage: 8, status: 'engaged', referred_by_partner_id: sydneySettlementsId, referral_fee_note: 'Flat $500 referral fee' },
    { name: 'Lucas Martin', phone: '0401 234 120', email: 'lucas.martin@example.com', budget_label: '$680,000 - $740,000', stage: 9, status: 'engaged', next_action_label: 'Confirm building & pest results', next_action_date: daysFromNow(2) },
    { name: 'Henry Davies', phone: '0401 234 122', email: 'henry.davies@example.com', budget_label: '$820,000 - $890,000', stage: 10, status: 'settled', next_action_label: 'Final walkthrough', next_action_date: daysFromNow(4) },
    { name: 'Grace Wilson', phone: '0401 234 123', email: 'grace.wilson@example.com', budget_label: '$730,000 - $790,000', stage: 11, status: 'settled' },
    { name: 'Ethan Brown', phone: '0401 234 124', email: 'ethan.brown@example.com', budget_label: '$880,000 - $940,000', stage: 11, status: 'settled', notes: 'Settled two weeks ago — a great one to show off the Completed view.' },
    { name: 'Ryan Foster', phone: '0401 234 126', email: 'ryan.foster@example.com', budget_label: '$600,000 - $650,000', stage: 1, status: 'lost', notes: 'Paused their search indefinitely.', archivedDaysAgo: 10 },
  ];

  const clientIds = {};
  for (const c of demoClients) {
    const info = insertClient.run({
      name: c.name,
      phone: c.phone || null,
      email: c.email || null,
      budget_label: c.budget_label || null,
      stage_id: stageId(c.stage),
      status: c.status || 'cold',
      next_action_label: c.next_action_label || null,
      next_action_date: c.next_action_date || null,
      referred_by_partner_id: c.referred_by_partner_id || null,
      referral_fee_note: c.referral_fee_note || null,
      notes: c.notes || null,
      archived_at: c.archivedDaysAgo ? timeAgo(c.archivedDaysAgo * 24) : null,
    });
    clientIds[c.name] = info.lastInsertRowid;
  }

  const insertCall = db.prepare(`
    INSERT INTO call_logs (client_id, type, note, logged_at)
    VALUES (@client_id, @type, @note, @logged_at)
  `);

  const demoCalls = [
    { name: 'Liam Bennett', type: 'call', note: 'Discussed budget flexibility.', hoursAgo: 48 },
    { name: 'Ava Patel', type: 'text', note: 'Confirmed Saturday inspection times.', hoursAgo: 5 },
    { name: 'Oliver Kim', type: 'voicemail', note: 'Left a message about auction strategy.', hoursAgo: 26 },
    { name: 'Henry Davies', type: 'call', note: 'Ran through the pre-settlement checklist.', hoursAgo: 20 },
  ];

  for (const call of demoCalls) {
    insertCall.run({
      client_id: clientIds[call.name],
      type: call.type,
      note: call.note,
      logged_at: timeAgo(call.hoursAgo),
    });
  }
}

module.exports = { seedDemoData, seedDemoUser };
