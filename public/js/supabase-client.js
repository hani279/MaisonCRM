// Fetches the (public, safe-to-expose) Supabase URL + anon key from the
// backend and initializes the browser Supabase client. app.js awaits
// window.supabaseReady before touching window.supabaseClient.
window.supabaseReady = fetch('/api/config')
  .then((r) => r.json())
  .then(({ supabaseUrl, supabaseAnonKey }) => {
    window.supabaseClient = supabase.createClient(supabaseUrl, supabaseAnonKey);
    // Fires when the user lands here via a password-reset email link. app.js
    // (loaded after this file) sets window.onPasswordRecovery once its own
    // handler exists; the pendingPasswordRecovery flag covers the case where
    // this fires before that assignment happens.
    window.supabaseClient.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        window.pendingPasswordRecovery = true;
        if (window.onPasswordRecovery) window.onPasswordRecovery();
      }
    });
  });
