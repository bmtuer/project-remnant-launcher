import { create } from 'zustand';
import { supabase } from '../auth/supabase.js';

// State machine for the launcher shell.
//   boot    → reading stored tokens / checking launcher self-update
//   auth    → showing AuthScreen
//   home    → showing HomeScreen (signed in)
//   playing → game spawned; main window hidden, tray-only
//
// State transitions:
//   boot    → auth   when no valid stored session
//   boot    → home   when stored session restored cleanly
//   auth    → home   on successful signIn()
//   home    → auth   on signOut()
//   home    → playing on launchGame() (PR 5; stub for now)
//   playing → home    when game exits

export const useAppStore = create((set, get) => ({
  // Lifecycle ─────────────────────────────────────────────────────
  state: 'boot',

  // Account ───────────────────────────────────────────────────────
  /** Supabase session (access_token + refresh_token + expires_at + user) */
  session: null,
  /** Convenience: signed-in email */
  email: null,

  // UI overlays (only meaningful in `home` state) ──────────────────
  settingsOpen: false,
  accountPopoverOpen: false,

  // Sign-in form state ────────────────────────────────────────────
  signInError: null,
  signInBusy: false,

  // ── Actions ────────────────────────────────────────────────────
  setState: (state) => set({ state }),

  openSettings:  () => set({ settingsOpen: true,  accountPopoverOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  toggleAccountPopover: () =>
    set((s) => ({ accountPopoverOpen: !s.accountPopoverOpen, settingsOpen: false })),
  closeAccountPopover: () => set({ accountPopoverOpen: false }),

  // Boot — try to restore a session from main-process token storage.
  // On success: hydrate Supabase client, set state=home.
  // On miss / expired / decrypt-failure: set state=auth.
  hydrate: async () => {
    try {
      const stored = await window.launcher.tokens.get();
      if (!stored?.access_token || !stored?.refresh_token) {
        set({ state: 'auth' });
        return;
      }
      // Reject tokens within 60s of expiry — Supabase's autorefresh would
      // also call here, but we'd rather just go to sign-in than show a
      // half-broken home screen.
      const buffer = 60;
      if (stored.expires_at && stored.expires_at < Date.now() / 1000 + buffer) {
        await window.launcher.tokens.clear();
        set({ state: 'auth' });
        return;
      }
      const { data, error } = await supabase.auth.setSession({
        access_token: stored.access_token,
        refresh_token: stored.refresh_token,
      });
      if (error || !data?.session) {
        await window.launcher.tokens.clear();
        set({ state: 'auth' });
        return;
      }
      // Re-persist with refreshed tokens (setSession may have rotated them).
      await window.launcher.tokens.set(serializeSession(data.session));
      set({
        state: 'home',
        session: data.session,
        email: data.session.user?.email ?? null,
      });
    } catch (err) {
      // Any failure → start clean at auth.
      set({ state: 'auth', session: null, email: null });
    }
  },

  signIn: async (email, password) => {
    set({ signInBusy: true, signInError: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      await window.launcher.tokens.set(serializeSession(data.session));
      set({
        state: 'home',
        session: data.session,
        email: data.session.user?.email ?? null,
        signInBusy: false,
        signInError: null,
      });
    } catch (err) {
      set({ signInBusy: false, signInError: friendlyAuthError(err) });
    }
  },

  signOut: async () => {
    try {
      await supabase.auth.signOut();
    } catch {
      // Network failure shouldn't strand the user signed-in locally.
    }
    await window.launcher.tokens.clear();
    set({
      state: 'auth',
      session: null,
      email: null,
      settingsOpen: false,
      accountPopoverOpen: false,
    });
  },

  // ─── Game lifecycle ──────────────────────────────────────────
  // PR 5 wires the version-gate sequence (check realm latest_version,
  // run differential update, then spawn). PR 2 lands the spawn path
  // itself; the version gate currently no-ops.
  //
  // Bundle handed to game via stdin includes:
  //   - jwt + refreshToken: current Supabase session
  //   - accountId + email: identity convenience
  //   - env + realmId: tells the game which game DB to point at
  //   - launcherPipePath: PID-scoped pipe for runtime IPC (token refresh)
  launchGame: async () => {
    const session = get().session;
    if (!session) {
      set({ signInError: 'Sign in before launching the game.' });
      return;
    }
    const launcherPipePath = await window.launcher.ipc.getPipePath();
    const bundle = {
      jwt:               session.access_token,
      refreshToken:      session.refresh_token,
      accountId:         session.user?.id ?? null,
      email:             session.user?.email ?? null,
      env:               'test',          // PR 5 plumbs the active realm
      realmId:           'test',
      launcherPipePath,
    };
    set({ state: 'playing' });
    const result = await window.launcher.game.spawn(bundle);
    if (!result?.ok) {
      // Spawn failed — restore the home state so the player sees what
      // happened. spawn-error event handler (registered once at app
      // boot) will toast the specific error.
      set({ state: 'home' });
    }
  },
}));

// Refresh-token round-trip — main calls this from `tokens:refresh`
// IPC handler when the spawned game requests a fresh access_token.
// Lives on `window` so main can reach it via executeJavaScript.
//
// We don't expose this through the contextBridge: it's intentionally
// internal, and main is the only caller.
if (typeof window !== 'undefined') {
  window.__refreshTokens = async () => {
    const { data, error } = await supabase.auth.refreshSession();
    if (error || !data?.session) {
      throw error ?? new Error('refreshSession returned no session');
    }
    const fresh = {
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at:    data.session.expires_at ?? null,
      email:         data.session.user?.email ?? null,
      player_id:     data.session.user?.id ?? null,
    };
    // Mirror the new session into the store so any renderer code
    // calling future server endpoints uses the rotated token.
    useAppStore.setState({ session: data.session });
    return fresh;
  };
}

function serializeSession(session) {
  return {
    access_token:  session.access_token,
    refresh_token: session.refresh_token,
    expires_at:    session.expires_at ?? null,
    email:         session.user?.email ?? null,
    player_id:     session.user?.id ?? null,
  };
}

function friendlyAuthError(err) {
  const msg = err?.message ?? 'Sign-in failed.';
  if (/invalid login/i.test(msg)) return 'Email or password is incorrect.';
  if (/email not confirmed/i.test(msg)) return 'Please verify your email — check your inbox for the confirmation link.';
  // "Failed to fetch" on a Supabase call from Electron typically means our
  // CSP is blocking connect-src. Surface a different message so we don't
  // gaslight ourselves into thinking the user's network is down.
  if (/failed to fetch/i.test(msg)) {
    return 'Could not reach the auth server. If this persists, the launcher build may need updating.';
  }
  if (/network|fetch/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}
