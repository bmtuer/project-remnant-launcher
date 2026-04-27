// Renderer-side Socket.io client for the launcher's live status feed.
//
// Connects to the game server's `/launcher` namespace with the
// current Supabase JWT. Receives `launcher:status` events whenever
// the server's maintenance flag flips. Updates appStore.serverState
// on every receive.
//
// Lifecycle:
//   - connect() called on home mount (post-auth)
//   - disconnect() called on sign-out + app teardown
//   - Auto-reconnect handled by socket.io-client (10 attempts,
//     exponential backoff)
//   - On reconnect, the server's `/launcher` namespace re-sends a
//     fresh `launcher:status` snapshot — no extra REST call needed
//   - Polling fallback: useAppStore's loadServerStatus() also runs
//     on a 5-min interval as belt-and-suspenders for the case where
//     the socket is genuinely broken (e.g. corporate firewall blocks
//     WebSocket upgrade)

import { io } from 'socket.io-client';
import { useAppStore } from '../store/appStore.js';

const API_BASE = import.meta.env.VITE_GAME_API_URL;

// API_BASE is e.g. "http://localhost:3001/api/v1". Strip the /api/v1
// suffix to get the Socket.io origin (Socket.io connects to the root,
// not under a path).
function socketOrigin() {
  if (!API_BASE) return null;
  return API_BASE.replace(/\/api\/v1\/?$/, '');
}

let socket = null;

/**
 * Open the launcher socket connection. Idempotent — safe to call on
 * every home mount.
 */
export function connectLauncherSocket() {
  if (socket && socket.connected) return socket;
  if (socket) {
    // We have a socket instance from a prior connect that's currently
    // disconnected (e.g., user signed out and back in). Tear it down
    // before creating a new one — old session tokens won't work.
    socket.disconnect();
    socket = null;
  }

  const session = useAppStore.getState().session;
  if (!session?.access_token) {
    return null;
  }

  const origin = socketOrigin();
  if (!origin) return null;

  socket = io(`${origin}/launcher`, {
    auth: { token: session.access_token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10_000,
  });

  socket.on('launcher:status', (payload) => {
    // Same shape as GET /api/v1/status. Apply via the shared reducer.
    useAppStore.getState().applyServerStatus(payload);
  });

  socket.on('connect_error', (err) => {
    // Silent — REST polling fallback covers persistent failures.
    // Only logged at debug level to avoid noise in dev console.
    if (import.meta.env.DEV) {
      console.debug('[launcher-socket] connect_error:', err?.message);
    }
  });

  return socket;
}

/**
 * Tear down the connection. Called on sign-out.
 */
export function disconnectLauncherSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
