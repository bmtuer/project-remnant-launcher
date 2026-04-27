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
}));

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
  if (/network|fetch/i.test(msg)) return 'Network error — check your connection and try again.';
  return msg;
}
