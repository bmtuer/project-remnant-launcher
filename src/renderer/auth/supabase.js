import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    '[launcher] VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set in .env. ' +
    'Copy from project-remnant/.env (see .env.example).'
  );
}

// Identity-project anon key only — service role lives only in the portal +
// Bryan's local .env.release. See docs/systems/auth.md (game repo).
//
// persistSession is FALSE here: the launcher's main process owns token
// storage (safeStorage in tokenStore.js). The renderer holds an in-memory
// session for the duration of a launcher session; on launch we restore
// from main-process storage via window.launcher.tokens.get().
export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
