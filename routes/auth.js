const express = require('express');
const db = require('../db');
const supabaseAdmin = require('../db/supabaseAdmin');

const router = express.Router();

// Public sign-up is never exposed to the browser — every account, including
// the first admin, is created here via the service-role Admin API. This
// keeps a stranger who has the (necessarily public) anon key from ever being
// able to self-register and get read/write access to the CRM.
//
// "Has setup run" is tracked per-schema in app_meta rather than by counting
// Supabase Auth users, because Auth is project-wide, not schema-scoped — the
// demo deployment's permanent login would otherwise make the real app think
// setup was already done (and vice versa).
async function setupDone() {
  const { rows } = await db.query("SELECT 1 FROM app_meta WHERE key = 'admin_created'");
  return rows.length > 0;
}

router.get('/status', async (req, res) => {
  res.json({ needsSetup: !(await setupDone()) });
});

router.post('/setup', async (req, res) => {
  if (await setupDone()) {
    return res.status(403).json({ error: 'Setup has already been completed.' });
  }

  const { name, email, password } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim(), role: 'admin', schema: db.schema },
  });
  if (error) return res.status(400).json({ error: error.message });

  await db.query(
    "INSERT INTO app_meta (key, value) VALUES ('admin_created', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true'"
  );

  res.status(201).json({ id: data.user.id, name: name.trim(), email: data.user.email, role: 'admin' });
});

module.exports = router;
