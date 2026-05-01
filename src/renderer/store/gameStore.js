import { create } from 'zustand';
import { useAppStore } from './appStore.js';
import { useRealmStore } from './realmStore.js';

const API_BASE = import.meta.env.VITE_GAME_API_URL;

// Wraps the main-process gameUpdater IPC. Owns the renderer-side
// view of game-binary state:
//
//   - installedVersionByEnv: per-realm version string (or null if not
//     installed). Loaded from main on home mount + after each
//     successful install.
//
//   - update.{phase, percent, downloaded, total, version, error}:
//     active update lifecycle. Phase mirrors gameUpdater.js's status
//     events: idle | manifest | verifying | downloading | installing
//     | done | error. Renderer subscribes via window.launcher.game
//     .onUpdateStatus (wired once at boot in App.jsx).
//
// Versioned-install architecture (post-v1.0.10): each game version
// installs to a fresh, unique directory. The "active" version is just
// a state-file pointer — switching versions never modifies an
// existing install dir. Eliminates the class of "can't replace the
// active install" failures we previously hit. See gameUpdater.js
// for full rationale.

export const useGameStore = create((set, get) => ({
  installedVersionByEnv: {},   // { test: '0.8.3', live: null, ... }

  update: {
    phase:      'idle',         // idle | manifest | verifying | downloading | installing | done | error
    percent:    0,
    downloaded: 0,
    total:      0,
    version:    null,
    error:      null,
  },

  /** Refresh installedVersion for one env from main. */
  loadInstalledVersion: async (env) => {
    try {
      const v = await window.launcher.game.getInstalledVersion(env);
      set((s) => ({
        installedVersionByEnv: { ...s.installedVersionByEnv, [env]: v },
      }));
    } catch (err) {
      // Non-fatal — read failure means we report null + continue.
      console.warn('[gameStore] getInstalledVersion failed:', err?.message);
    }
  },

  /** Apply a status payload from the main-process IPC subscription. */
  applyStatus: (payload) => {
    set((s) => {
      const next = { ...s.update, ...payload };
      // Normalize fields. Phase is the canonical state; percent
      // resets to 0 on phase change unless explicitly provided.
      if (payload.phase && payload.phase !== s.update.phase) {
        if (payload.percent === undefined) next.percent = 0;
      }
      return { update: next };
    });

    // On a successful install, refresh installedVersion so the
    // bottom-left readout updates without a window reload.
    if (payload.phase === 'done' && payload.version) {
      const env = useRealmStore.getState().selectedRealmId ?? 'test';
      get().loadInstalledVersion(env);
    }
  },

  /** Trigger verify-or-install for the currently-selected realm.
   *  Idempotent: if a flow is already in-flight, the main-process
   *  inFlightByEnv guard returns the existing Promise instead of
   *  starting a second flow. */
  verifyOrInstallActive: async () => {
    const realm = useRealmStore.getState();
    const app   = useAppStore.getState();
    const env   = realm.selectedRealmId;
    const jwt   = app.session?.access_token;

    if (!env || !jwt || !API_BASE) return null;

    const phase = get().update.phase;
    if (phase === 'manifest' || phase === 'verifying' ||
        phase === 'downloading' || phase === 'installing') {
      // Already in progress; let the existing flow finish.
      return null;
    }

    return window.launcher.game.verifyOrInstall({
      apiBase: API_BASE,
      env,
      jwt,
    });
  },

  /** Force-repair — clears active pointer + redownloads
   *  unconditionally. Used by Settings → Repair. */
  forceRepairActive: async () => {
    const realm = useRealmStore.getState();
    const app   = useAppStore.getState();
    const env   = realm.selectedRealmId;
    const jwt   = app.session?.access_token;

    if (!env || !jwt || !API_BASE) return null;

    return window.launcher.game.forceRepair({
      apiBase: API_BASE,
      env,
      jwt,
    });
  },

  resetUpdateState: () => set({
    update: { phase: 'idle', percent: 0, downloaded: 0, total: 0, version: null, error: null },
  }),
}));
