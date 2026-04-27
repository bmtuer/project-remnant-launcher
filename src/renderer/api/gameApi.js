// Minimal fetcher for launcher-server endpoints. Auto-attaches the
// current Supabase access token from useAppStore as Authorization
// header. All endpoints under VITE_GAME_API_URL/launcher/* are
// auth-gated server-side.
//
// We don't need a heavyweight SDK here — the launcher only talks to
// /launcher/* endpoints (PR 3 + PR 5). Three GET routes total at v1.

import { useAppStore } from '../store/appStore.js';

const API_BASE = import.meta.env.VITE_GAME_API_URL;

if (!API_BASE) {
  throw new Error(
    '[launcher] VITE_GAME_API_URL must be set in .env. ' +
    'See .env.example for the expected value.',
  );
}

async function authedGet(path) {
  const session = useAppStore.getState().session;
  if (!session?.access_token) {
    throw new Error('No session — sign in before calling launcher endpoints.');
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

/**
 * GET /status — public, unauthenticated. Returns the live server
 * state the launcher gates on:
 *   - maintenance: bool
 *   - message: maintenance message (when maintenance is true)
 *   - minClientVersion: server's required game-binary version
 *   - minLauncherVersion: server's required launcher version
 *
 * Called pre-auth (so an outdated launcher learns it needs to update
 * before it tries to sign in) AND post-auth (defense in depth +
 * polling fallback when Socket.io is disconnected).
 */
export async function fetchServerStatus() {
  const res = await fetch(`${API_BASE}/status`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Status ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export async function fetchAnnouncements() {
  const data = await authedGet('/launcher/announcements');
  return data.announcements ?? [];
}

export async function fetchPatchNotes() {
  const data = await authedGet('/launcher/patch-notes');
  return data.patchNotes ?? [];
}
