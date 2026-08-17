// Captured immediately, before Supabase's client (created below) gets a
// chance to touch the URL — it clears the recovery hash from the address bar
// shortly after processing it, and by then it may have also already
// silently established a session from the token. Relying on getSession()
// alone at that point can't tell "freshly landed via reset link" apart from
// "already signed in", so checkAuthAndInit() checks this synchronous
// snapshot instead of racing the async PASSWORD_RECOVERY event.
window.hadRecoveryHashOnLoad = /type=recovery/.test(window.location.hash);

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
