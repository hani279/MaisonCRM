const express = require('express');
const db = require('../db');
const supabaseAdmin = require('../db/supabaseAdmin');

const router = express.Router();

function publicUser(u) {
  return {
    id: u.id,
    name: (u.user_metadata && u.user_metadata.name) || '',
    email: u.email,
    role: (u.user_metadata && u.user_metadata.role) || 'member',
    created_at: u.created_at,
  };
}

// Supabase Auth's user list is project-wide, not schema-scoped, but the real
// app and the demo deployment share one project — every user is tagged with
// the schema that owns it at creation time so each deployment's Settings ->
// Users only ever shows (and can only ever delete) its own logins.
function belongsToThisSchema(u) {
  return u.user_metadata && u.user_metadata.schema === db.schema;
}

// Agency/dev accounts (e.g. whoever built and maintains this deployment) are
// tagged hidden: true so they don't show up in the client's own Settings ->
// Users list and don't read as team members who need managing. The accounts
// themselves still work for signing in — this only affects this listing.
function isHidden(u) {
  return !!(u.user_metadata && u.user_metadata.hidden);
}

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return res.status(500).json({ error: error.message });
  const users = data.users
    .filter((u) => belongsToThisSchema(u) && !isHidden(u))
    .sort((a, b) => publicUser(a).name.localeCompare(publicUser(b).name));
  res.json(users.map(publicUser));
});

router.post('/', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required.' });
  if (!email || !email.trim()) return res.status(400).json({ error: 'Email is required.' });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { name: name.trim(), role: role === 'admin' ? 'admin' : 'member', schema: db.schema },
  });
  if (error) {
    if (error.message.toLowerCase().includes('already been registered')) {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    return res.status(400).json({ error: error.message });
  }

  const created = publicUser(data.user);
  await db.query('INSERT INTO users (id, name, email, role) VALUES ($1, $2, $3, $4)', [
    created.id,
    created.name,
    created.email,
    created.role,
  ]);

  res.status(201).json(created);
});

router.delete('/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "You can't delete your own account." });
  }
  const { data, error: getError } = await supabaseAdmin.auth.admin.getUserById(req.params.id);
  if (getError || !data.user || !belongsToThisSchema(data.user)) {
    return res.status(404).json({ error: 'not found' });
  }
  const { error } = await supabaseAdmin.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
  res.status(204).end();
});

module.exports = router;
