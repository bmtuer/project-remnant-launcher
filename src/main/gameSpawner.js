// Spawns the game binary as a child process. The JWT bundle is staged
// on the launcher's IPC named-pipe server keyed by a one-shot nonce;
// we pass LAUNCHER_PIPE_PATH + LAUNCHER_HANDOFF_NONCE in the child env
// and the game connects to the pipe at boot to retrieve it.
//
// We tried stdin handoff first (industry-typical for Unix tools).
// Windows GUI-subsystem Electron binaries don't reliably receive stdin
// from a parent process — the spawned game's stdin pipe stays empty
// even when the parent writes synchronously after spawn. The named
// pipe is the standard pattern for this on Windows (Battle.net,
// FFXIV, Steam overlay all use named pipes for launcher↔game), and
// we already had one running for runtime token refresh.
//
// Token bytes never appear in env. Only the pipe path + a 16-byte
// random nonce. After the game's first successful `get-bundle` with
// the matching nonce, the staged bundle is evicted — a racing
// observer either loses the race or gets `no-bundle`.
//
// Game-binary location for v1: %APPDATA%/RemnantLauncher/game/{env}/.
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
 * Spawn the game. The JWT bundle is staged on the launcher's IPC
 * named-pipe server (see `ipcServer.js#stageBundle`); this module
 * passes the pipe path + nonce in the child env so the game can
 * connect and retrieve the bundle at boot.
 *
 * Caller is responsible for hiding/showing the launcher main window
 * around this call — this module only owns the child process.
 *
 * @param {object} bundle - { jwt, refreshToken, accountId, env, realmId }
 * @param {object} hooks  - { handoff: { pipePath, nonce }, onExit?, onSpawnError? }
 */
export function spawnGame(bundle, hooks = {}) {
  if (isGameRunning()) {
    throw new Error('Game is already running.');
  }
  if (!hooks.handoff?.pipePath || !hooks.handoff?.nonce) {
    throw new Error('spawnGame: handoff { pipePath, nonce } is required.');
  }

  const env = bundle.env ?? 'test';
  const binaryPath = resolveGameBinaryPath(env);

  if (!existsSync(binaryPath)) {
    const err = new Error(
      `Game binary not found at ${binaryPath}. Run verifyOrInstall first.`,
    );
    err.code = 'GAME_BINARY_MISSING';
    hooks.onSpawnError?.(err);
    return null;
  }

  // Scrub Electron-internal env vars that would mis-configure the
  // spawned game:
  //
  // - ELECTRON_RUN_AS_NODE: when set, Electron drops the Chromium
  //   runtime and runs as plain Node. Crashes the game on boot.
  //   Common enough on Windows dev boxes (some tooling sets it
  //   globally) that defensive scrubbing is worth the line.
  //
  // - ELECTRON_RENDERER_URL: set by electron-vite in dev mode. Points
  //   at the LAUNCHER's renderer dev server when the launcher runs
  //   under `pnpm dev`. If we leave it in the child env, the game's
  //   main process loads the launcher's renderer URL — game window
  //   shows launcher UI. Strip it.
  //
  // - ELECTRON_DISABLE_SANDBOX, ELECTRON_NO_ATTACH_CONSOLE: same
  //   class — internal flags that would cross-contaminate the child.
  //
  // Then inject the handoff env vars: pipe path + one-shot nonce.
  // The bundle bytes themselves never touch env (visible to other
  // processes) — only the pipe path + nonce, both single-use.
  const childEnv = { ...process.env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.ELECTRON_RENDERER_URL;
  delete childEnv.ELECTRON_DISABLE_SANDBOX;
  delete childEnv.ELECTRON_NO_ATTACH_CONSOLE;
  childEnv.LAUNCHER_PIPE_PATH = hooks.handoff.pipePath;
  childEnv.LAUNCHER_HANDOFF_NONCE = hooks.handoff.nonce;

  const child = spawn(binaryPath, [], {
    stdio: 'ignore',
    detached: false,
    windowsHide: false,
    env: childEnv,
  });

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
