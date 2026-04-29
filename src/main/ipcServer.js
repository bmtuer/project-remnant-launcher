// Named-pipe IPC server for runtime communication with the spawned
// game process. Two responsibilities:
//
//   1. Boot handoff. On Play, launcher stages the JWT bundle keyed by
//      a one-shot random nonce + spawns the game with the nonce + pipe
//      path in its env. Game connects, sends `get-bundle` with the
//      nonce, receives the bundle. Bundle is evicted after first read.
//      Stdin handoff was tried first but Windows GUI-subsystem Electron
//      binaries don't reliably receive stdin from the parent. Named
//      pipes are the standard pattern for this on Windows (Battle.net,
//      FFXIV, Steam overlay all use them).
//
//   2. Runtime token refresh. When the game's JWT nears expiry, the
//      game sends `refresh-token`; launcher responds with a fresh JWT.
//
// Implementation: Node's built-in `net` module + a Windows named pipe.
// No library dep. Pipe path includes the launcher's PID so multiple
// launcher processes (theoretical edge case) don't collide.
//
// Cross-platform port to Unix sockets (just swap the path) deferred —
// trivial when needed.
//
// Wire protocol: newline-delimited JSON. Each frame is one JSON object
// + a trailing `\n`. Server consumer parses one line at a time and
// responds in kind.
//
// Security model for boot handoff: the pipe path lives in the spawned
// game's env (visible to other processes under the same user via
// `tasklist /v`). Mitigated by a one-shot nonce — only the first
// successful `get-bundle` with the matching nonce gets the bundle;
// after that, the bundle is evicted. A racing attacker either loses
// the race (game already consumed it) or sees an empty stage.

import net from 'node:net';
import { randomBytes } from 'node:crypto';

const PIPE_PREFIX = '\\\\.\\pipe\\remnant-launcher-';

let server = null;
let pipePath = null;

// Boot-handoff stage. Keyed by nonce; one-shot read.
//   stagedBundles.set(nonce, bundle)  on stageBundle()
//   stagedBundles.delete(nonce)       on first successful get-bundle
const stagedBundles = new Map();

/**
 * Pipe path for this launcher process (PID-scoped).
 */
export function getPipePath() {
  return pipePath ?? `${PIPE_PREFIX}${process.pid}`;
}

/**
 * Stage a bundle for one-shot handoff to a soon-to-be-spawned game.
 * Returns the nonce the launcher must pass to the game (via env var).
 * The game connects to the pipe, sends `get-bundle` with this nonce,
 * and receives the bundle exactly once. Bundle is evicted on first
 * successful read.
 *
 * @param {object} bundle - { jwt, refreshToken, accountId, env, ... }
 * @returns {string} nonce (hex, 32 chars)
 */
export function stageBundle(bundle) {
  const nonce = randomBytes(16).toString('hex');
  stagedBundles.set(nonce, bundle);
  return nonce;
}

/**
 * Drop a previously staged bundle without it being read. Use if the
 * spawn fails after stageBundle was called — prevents the bundle
 * sitting in memory indefinitely.
 */
export function dropStagedBundle(nonce) {
  if (nonce) stagedBundles.delete(nonce);
}

/**
 * Start the IPC server. The handlers map message types to async
 * functions returning a response. Unknown message types respond with
 * { ok: false, error: 'unknown-type' }.
 *
 * The built-in `get-bundle` handler is always installed and consumes
 * the staged bundle for the matching nonce. Callers must not pass
 * their own `get-bundle` handler — it's reserved.
 *
 * @param {Record<string, (payload: any) => Promise<any>>} handlers
 * @param {object} logger - { info, warn, error } for telemetry
 */
export function startIpcServer(handlers, logger = console) {
  if (server) {
    throw new Error('IPC server already running.');
  }

  // Built-in handler. Reserved name; merges with caller's handlers.
  const merged = {
    ...handlers,
    'get-bundle': async (payload) => {
      const nonce = payload?.nonce;
      if (!nonce || typeof nonce !== 'string') {
        throw new Error('missing-nonce');
      }
      const bundle = stagedBundles.get(nonce);
      if (!bundle) {
        // Either wrong nonce, already-consumed nonce, or never staged.
        // Don't distinguish — every failure looks the same to attackers.
        throw new Error('no-bundle');
      }
      stagedBundles.delete(nonce);
      return bundle;
    },
  };
  handlers = merged;

  pipePath = `${PIPE_PREFIX}${process.pid}`;

  server = net.createServer((socket) => {
    let buffer = '';

    socket.on('data', async (chunk) => {
      buffer += chunk.toString('utf8');

      // Process complete lines; leave any partial line buffered.
      let newlineIdx;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        if (!line.trim()) continue;

        let req;
        try {
          req = JSON.parse(line);
        } catch (parseErr) {
          socket.write(JSON.stringify({ ok: false, error: 'bad-json' }) + '\n');
          continue;
        }

        const { id, type, payload } = req ?? {};
        const handler = handlers[type];

        if (!handler) {
          socket.write(JSON.stringify({ id, ok: false, error: 'unknown-type' }) + '\n');
          continue;
        }

        try {
          const result = await handler(payload);
          socket.write(JSON.stringify({ id, ok: true, result }) + '\n');
        } catch (handlerErr) {
          logger.warn?.(`[ipc] handler ${type} failed:`, handlerErr?.message);
          socket.write(
            JSON.stringify({
              id,
              ok: false,
              error: handlerErr?.message ?? 'handler-failed',
            }) + '\n',
          );
        }
      }
    });

    socket.on('error', (err) => {
      // Common: client (game) disconnects without graceful close. Not
      // worth more than a debug log; the game's lifecycle owns when
      // it reconnects.
      logger.info?.(`[ipc] socket error: ${err?.message}`);
    });
  });

  server.on('error', (err) => {
    logger.error?.(`[ipc] server error: ${err?.message}`);
  });

  server.listen(pipePath, () => {
    logger.info?.(`[ipc] listening on ${pipePath}`);
  });
}

/**
 * Stop the IPC server. Safe to call multiple times.
 */
export function stopIpcServer() {
  if (!server) return;
  try { server.close(); } catch { /* ignore */ }
  server = null;
  pipePath = null;
}
