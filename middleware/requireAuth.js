const db = require('../db');
const supabaseAdmin = require('../db/supabaseAdmin');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Not authenticated' });

  // Supabase Auth is shared across the whole project (the real app and the
  // demo deployment both point at it), so a valid token alone isn't enough —
  // it also has to belong to the deployment it's being used against, or the
  // demo login could read/write Robert's real data (and vice versa).
  if (!data.user.user_metadata || data.user.user_metadata.schema !== db.schema) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  req.user = data.user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.user_metadata && req.user.user_metadata.role === 'admin') {
    return next();
  }
  res.status(403).json({ error: 'Admin access required' });
}

module.exports = { requireAuth, requireAdmin };
