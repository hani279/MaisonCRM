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

router.get('/', async (req, res) => {
  const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
  if (error) return res.status(500).json({ error: error.message });
  const users = data.users
    .filter(belongsToThisSchema)
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

  res.status(201).json(publicUser(data.user));
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
  res.status(204).end();
});

module.exports = router;
