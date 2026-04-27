// Named-pipe IPC server for runtime communication with the spawned
// game process. Per the launcher-split plan: when the game's JWT
// nears expiry, the game sends a `refresh-token` message; launcher
// responds with a fresh JWT; game updates its auth header on next
// request.
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

import net from 'node:net';

const PIPE_PREFIX = '\\\\.\\pipe\\remnant-launcher-';

let server = null;
let pipePath = null;

/**
 * Pipe path for this launcher process (PID-scoped).
 */
export function getPipePath() {
  return pipePath ?? `${PIPE_PREFIX}${process.pid}`;
}

/**
 * Start the IPC server. The handlers map message types to async
 * functions returning a response. Unknown message types respond with
 * { ok: false, error: 'unknown-type' }.
 *
 * @param {Record<string, (payload: any) => Promise<any>>} handlers
 * @param {object} logger - { info, warn, error } for telemetry
 */
export function startIpcServer(handlers, logger = console) {
  if (server) {
    throw new Error('IPC server already running.');
  }

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
