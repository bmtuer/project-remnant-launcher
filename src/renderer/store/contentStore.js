import { create } from 'zustand';
import { fetchAnnouncements, fetchPatchNotes } from '../api/gameApi.js';

// Holds the launcher's home-screen content: announcements + patch
// notes. Loaded once on home mount; could be re-loaded on a tray
// menu action or a periodic background refresh, but PR 3 ships a
// single fetch-on-mount model. Adding background polling would be
// trivial — just need a clear UX signal of "new announcement
// arrived" if we want to surface it.

export const useContentStore = create((set, get) => ({
  announcements: [],
  patchNotes:    [],
  loading:       false,
  error:         null,

  load: async () => {
    if (get().loading) return; // prevent duplicate concurrent fetches
    set({ loading: true, error: null });
    try {
      const [announcements, patchNotes] = await Promise.all([
        fetchAnnouncements(),
        fetchPatchNotes(),
      ]);
      set({ announcements, patchNotes, loading: false });
    } catch (err) {
      set({
        loading: false,
        error: err?.message ?? 'Failed to load content.',
      });
    }
  },

  reset: () => set({ announcements: [], patchNotes: [], loading: false, error: null }),
}));
