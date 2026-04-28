import { create } from 'zustand';

// Realm list + currently-selected realm.
//
// Source: GET /api/v1/launcher/realms (public, rate-limited per IP).
// We fetch on home mount + on every Socket.io reconnect (those events
// fire when the server restarts, which is when realm metadata —
// status, latest_version, player count — most often changes).
//
// Selection persistence: the player's pick goes through
// useAppStore.settings → defaultRealm via the existing settings
// IPC. v1 only has Test Realm so this is mostly architectural —
// when Live Realm lands at Phase 3 the selection persistence is
// already wired.

const API_BASE = import.meta.env.VITE_GAME_API_URL;

export const useRealmStore = create((set, get) => ({
  /** @type {Array<{id, name, type, status, players, latest_version}>} */
  realms: [],

  /** id of the currently-selected realm; defaults to first realm
   *  on first load + when selection points at a realm that no
   *  longer exists in the list (rare — admin removed a realm). */
  selectedRealmId: null,

  loading:  false,
  error:    null,

  load: async () => {
    if (!API_BASE) {
      set({ error: 'VITE_GAME_API_URL not configured.' });
      return;
    }
    if (get().loading) return; // prevent overlapping fetches
    set({ loading: true, error: null });
    try {
      const res = await fetch(`${API_BASE}/launcher/realms`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Realms ${res.status}: ${text || res.statusText}`);
      }
      const data = await res.json();
      const realms = data.realms ?? [];

      // Pick / fix selection. If we don't have one, or the prior
      // selection's realm vanished, select the first realm.
      let { selectedRealmId } = get();
      if (!selectedRealmId || !realms.some((r) => r.id === selectedRealmId)) {
        selectedRealmId = realms[0]?.id ?? null;
      }

      set({ realms, selectedRealmId, loading: false });
    } catch (err) {
      set({ loading: false, error: err?.message ?? 'Failed to fetch realms.' });
    }
  },

  selectRealm: (id) => {
    if (!get().realms.some((r) => r.id === id)) return;
    set({ selectedRealmId: id });
  },

  reset: () => set({ realms: [], selectedRealmId: null, loading: false, error: null }),
}));

/** Convenience selector — returns the active realm object or null. */
export function useActiveRealm() {
  return useRealmStore((s) => {
    const id = s.selectedRealmId;
    if (!id) return null;
    return s.realms.find((r) => r.id === id) ?? null;
  });
}
