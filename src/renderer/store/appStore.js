import { create } from 'zustand';
import { supabase } from '../auth/supabase.js';
import { fetchServerStatus } from '../api/gameApi.js';

/** Compares two semver strings ("0.1.2" vs "0.2.0"). Returns
 * negative if a < b, positive if a > b, 0 if equal. Strict X.Y.Z
 * format only — non-semver inputs return 0 (treated as equal, no
 * gate). String comparison fails for "0.4.10" < "0.4.9", which is
 * why we need numeric per-segment compare. */
function semverCompare(a, b) {
  if (!a || !b) return 0;
  const re = /^(\d+)\.(\d+)\.(\d+)$/;
  const ma = a.match(re);
  const mb = b.match(re);
  if (!ma || !mb) return 0;
  for (let i = 1; i <= 3; i++) {
    const da = Number(ma[i]) - Number(mb[i]);
    if (da !== 0) return da;
  }
  return 0;
}

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

  // Launcher self-update state. Updated by the launcher:update-status
  // IPC subscription wired in App.jsx. `status` mirrors the values
  // launcherUpdater.js emits; ui surfaces a banner when status is
  // `available` / `progress` / `ready`. `error` is logged but
  // non-blocking — launcher still works at the current version.
  update: {
    status: 'idle',  // idle | checking | available | progress | ready | up-to-date | error
    version: null,
    progress: 0,     // 0-100
    error: null,
  },

  // Live server state, fetched from GET /api/v1/status. Updated:
  //   - on launcher boot (pre-auth, lets us gate stale launchers
  //     from signing in)
  //   - on home-screen mount (post-auth, defense in depth)
  //   - via Socket.io launcher-status push (PR 4 step 3)
  //   - via 5-min polling fallback (PR 4 step 3)
  //
  // `loaded` flips true after the first successful fetch — used by
  // the auth screen so we don't gate sign-in on an unfetched state
  // (would lock players out during the first ~500ms of boot before
  // /status resolves).
  serverState: {
    loaded:             false,
    maintenance:        false,
    message:            null,
    minClientVersion:   null,
    minLauncherVersion: null,
    error:              null,
  },

  // Sign-in form state ────────────────────────────────────────────
  signInError: null,
  signInBusy: false,

  // ── Actions ────────────────────────────────────────────────────
  setState: (state) => set({ state }),

  // Launcher self-update event handler — wired once at boot in App.jsx
  // to window.launcher.updater.onUpdateStatus. Maintains the update
  // slice of the store; UI subscribes to s.update.status.
  setUpdateStatus: (payload) =>
    set((s) => ({
      update: {
        ...s.update,
        status: payload.status,
        ...(payload.version !== undefined ? { version: payload.version } : {}),
        ...(payload.percent !== undefined ? { progress: Math.round(payload.percent) } : {}),
        ...(payload.message !== undefined ? { error: payload.message } : {}),
      },
    })),

  // Load /status from the game server. Called on boot (pre-auth) and
  // again on home mount (post-auth, defense in depth). Socket.io push
  // events also call into the same `applyServerStatus` reducer so
  // socket + REST stay consistent.
  loadServerStatus: async () => {
    try {
      const data = await fetchServerStatus();
      set((s) => ({
        serverState: {
          ...s.serverState,
          loaded:             true,
          maintenance:        Boolean(data.maintenance),
          message:            data.message ?? null,
          minClientVersion:   data.minClientVersion ?? null,
          minLauncherVersion: data.minLauncherVersion ?? null,
          error:              null,
        },
      }));
    } catch (err) {
      set((s) => ({
        serverState: {
          ...s.serverState,
          // Don't reset existing state on a failed fetch — if we have
          // valid data from a prior load, preserve it rather than
          // flapping to defaults. Socket.io reconnects will retry.
          error: err?.message ?? 'Failed to fetch server status.',
        },
      }));
    }
  },

  // Apply a server-pushed status update (used by Socket.io listener
  // in PR 4 step 3). Same shape as loadServerStatus's success path.
  applyServerStatus: (data) =>
    set((s) => ({
      serverState: {
        ...s.serverState,
        loaded:             true,
        maintenance:        Boolean(data.maintenance),
        message:            data.message ?? null,
        minClientVersion:   data.minClientVersion ?? s.serverState.minClientVersion,
        minLauncherVersion: data.minLauncherVersion ?? s.serverState.minLauncherVersion,
        error:              null,
      },
    })),

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

/**
 * Selector: is the launcher's installed version below the server's
 * required minimum? Returns false until both `serverState.loaded`
 * and the launcher's version have been fetched, so we don't flash
 * a "stale" gate during boot.
 *
 * Caller passes the launcher version (read from app.getVersion()
 * via window.launcher.getVersion). Component:
 *
 *   const stale = useIsLauncherStale(launcherVersion);
 */
export function useIsLauncherStale(launcherVersion) {
  return useAppStore((s) => {
    if (!s.serverState.loaded) return false;
    const required = s.serverState.minLauncherVersion;
    if (!required || !launcherVersion) return false;
    return semverCompare(launcherVersion, required) < 0;
  });
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
