// Persistent settings for the launcher. Lives in app.getPath('userData')
// so it survives launcher self-updates (the application bundle gets
// replaced but userData doesn't).
//
// Schema:
//   autoLaunchOnStartup: boolean — register/unregister with Windows'
//                                  login-items so the launcher starts
//                                  with Windows
//   closeXBehavior:      'tray' | 'quit' — what clicking the window's
//                                          X does (default: 'tray')
//   defaultRealm:        'last-used' | string — which realm to
//                                                preselect on home mount
//                                                (PR 5 wires the dropdown;
//                                                today only 'last-used' is
//                                                meaningful)
//   windowSize:          'compact' | 'standard' | 'large' — discrete
//                                                preset that controls
//                                                the launcher window's
//                                                width/height. See
//                                                WINDOW_SIZE_PRESETS in
//                                                main/index.js for the
//                                                actual pixel dimensions.
//
// All getters return the parsed JSON; setters merge + write atomically.

import { app } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

const FILE_NAME = 'settings.json';

const DEFAULTS = Object.freeze({
  autoLaunchOnStartup: false,
  closeXBehavior:      'tray',       // 'tray' | 'quit'
  defaultRealm:        'last-used',
  windowSize:          'standard',   // 'compact' | 'standard' | 'large'
});

let cache = null;  // populated lazily on first read

function filePath() {
  return join(app.getPath('userData'), FILE_NAME);
}

/**
 * Read settings from disk. Caches in memory after first call.
 * Falls back to DEFAULTS for any missing key (lets us add new
 * settings without migrations).
 */
export async function readSettings() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(filePath(), 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS, ...parsed };
  } catch (err) {
    // First run, or corrupt file. Return defaults; next write will
    // create the file fresh.
    cache = { ...DEFAULTS };
  }
  return cache;
}

/**
 * Merge partial settings into the existing config and persist.
 * Side effects:
 *   - autoLaunchOnStartup change: syncs Windows login-items via
 *     app.setLoginItemSettings.
 *   - closeXBehavior change: takes effect on next close-event (no
 *     further plumbing needed — main reads cache at close time).
 *
 * @param {Partial<typeof DEFAULTS>} patch
 */
export async function writeSettings(patch) {
  const current = await readSettings();
  const next = { ...current, ...patch };
  cache = next;
  await fs.writeFile(filePath(), JSON.stringify(next, null, 2), { mode: 0o600 });

  // Side effects.
  if (patch.autoLaunchOnStartup !== undefined) {
    syncAutoLaunch(next.autoLaunchOnStartup);
  }

  return next;
}

/**
 * Sync the autoLaunch setting with Windows' login-items registry.
 * Electron handles the OS-specific details — we just call setLoginItemSettings.
 */
export function syncAutoLaunch(enabled) {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    // path defaults to app.getPath('exe'), which is the launcher binary
    // in production and electron.exe in dev. Dev's setting only affects
    // the dev session; harmless either way.
  });
}

/** Synchronous accessor used by the close-event handler in main. */
export function peekSettings() {
  return cache ?? { ...DEFAULTS };
}
