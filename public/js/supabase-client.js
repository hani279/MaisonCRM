// Fetches the (public, safe-to-expose) Supabase URL + anon key from the
// backend and initializes the browser Supabase client. app.js awaits
// window.supabaseReady before touching window.supabaseClient.
window.supabaseReady = fetch('/api/config')
  .then((r) => r.json())
  .then(({ supabaseUrl, supabaseAnonKey }) => {
    window.supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
  });
