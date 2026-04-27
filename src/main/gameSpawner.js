// Spawns the game binary as a child process with the JWT bundle handed
// off via stdin. Per the launcher-split plan and `docs/systems/auth.md`:
// stdin is invisible to other processes (env vars are visible via
// `tasklist /v` and captured in crash dumps; child processes inherit
// env). Industry MMOs avoid env vars for tokens for these reasons.
//
// Game-binary location for v1: %APPDATA%/RemnantLauncher/game/{env}/.
// PR 5 wires the actual install + update flow; this module just spawns
// from that location. If the binary doesn't exist (PR 2 reality —
// the launcher's wired but game distribution isn't), we fail
// gracefully with a toast back to the renderer.
//
// Exit-code conventions (mirrored on the game side):
//   0 - normal exit (player closed game from in-game)
//   1 - crash (renderer exception, hard fault)
//   2 - version-mismatch (server returned 426; game exited cleanly)
//   3 - auth-expired (JWT was rejected; game exited cleanly)
//   4 - server-unreachable (game couldn't connect; clean exit)

import { app, BrowserWindow } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const GAME_INSTALL_ROOT = join(app.getPath('appData'), 'RemnantLauncher', 'game');

// PR 5 will replace this with realm-aware path resolution. For now we
// just look for a single binary; if not present we surface a helpful
// error rather than silently failing.
function resolveGameBinaryPath(env = 'test') {
  return join(GAME_INSTALL_ROOT, env, 'RemnantGame.exe');
}

let activeChild = null;

/**
 * Returns true if a game process is currently running.
 */
export function isGameRunning() {
  return activeChild !== null && activeChild.exitCode === null;
}

/**
 * Spawn the game with a JWT bundle. Returns a Promise that resolves to
 * the exit code when the child exits, or rejects if spawn itself fails.
 *
 * Caller is responsible for hiding/showing the launcher main window
 * around this call — this module only owns the child process.
 *
 * @param {object} bundle - { jwt, refreshToken, accountId, env, realmId }
 * @param {object} hooks  - { onExit?: (code) => void, onSpawnError?: (err) => void }
 */
export function spawnGame(bundle, hooks = {}) {
  if (isGameRunning()) {
    throw new Error('Game is already running.');
  }

  const env = bundle.env ?? 'test';
  const binaryPath = resolveGameBinaryPath(env);

  if (!existsSync(binaryPath)) {
    // PR 5 wires real game distribution. Until then this is the
    // expected dev-side behavior — surface the missing-binary state
    // back to the renderer and let it show a friendly message rather
    // than crashing the launcher.
    const err = new Error(
      `Game binary not found at ${binaryPath}. Game updater + installer wires in PR 5.`,
    );
    err.code = 'GAME_BINARY_MISSING';
    hooks.onSpawnError?.(err);
    return null;
  }

  const child = spawn(binaryPath, [], {
    stdio: ['pipe', 'inherit', 'inherit'],
    detached: false,
    windowsHide: false,
  });

  // Write the bundle as a single JSON line, then close stdin. The game
  // reads exactly one line at boot and ignores anything afterward.
  // Closing stdin signals EOF — the game knows the handoff is done.
  try {
    child.stdin.write(JSON.stringify(bundle) + '\n');
    child.stdin.end();
  } catch (writeErr) {
    // If stdin write fails (extremely rare — pipe broken before we
    // write), kill the child + surface the error.
    try { child.kill(); } catch { /* ignore */ }
    const err = new Error(`Failed to write JWT bundle to game stdin: ${writeErr.message}`);
    err.code = 'STDIN_WRITE_FAILED';
    hooks.onSpawnError?.(err);
    return null;
  }

  activeChild = child;

  child.on('exit', (code, signal) => {
    activeChild = null;
    // Normalize signal-killed (Ctrl+C, etc) to crash-code 1 so the
    // dispatch table doesn't have to special-case null.
    const exitCode = code ?? (signal ? 1 : 0);
    hooks.onExit?.(exitCode, signal);
  });

  child.on('error', (spawnErr) => {
    activeChild = null;
    const err = new Error(`Game process error: ${spawnErr.message}`);
    err.code = 'PROCESS_ERROR';
    hooks.onSpawnError?.(err);
  });

  return child;
}

/**
 * Kill the active game child (used during launcher quit / sign-out).
 * No-op if no game is running.
 */
export function killGame() {
  if (!activeChild) return;
  try { activeChild.kill(); } catch { /* ignore */ }
  activeChild = null;
}

/**
 * Hide all launcher windows when the game launches. Tray icon stays
 * visible per the launcher's tray-resident pattern.
 */
export function hideLauncherWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.hide();
  }
}

/**
 * Restore all launcher windows after game exit.
 */
export function showLauncherWindows() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}
