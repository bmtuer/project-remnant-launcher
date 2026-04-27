import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useContentStore } from '../store/contentStore.js';
import AccountPopover from '../components/AccountPopover.jsx';
import SettingsModal  from '../components/SettingsModal.jsx';
import PatchNotesModal from '../components/PatchNotesModal.jsx';
import launcherHeroUrl from '../assets/launcher-hero.webp';
import { relativeDate } from '../utils/relativeDate.js';

// Capitalize a kind for the tag pill ("maintenance" → "Maintenance").
const KIND_LABELS = {
  maintenance: 'Maintenance',
  notice:      'Notice',
  patch:       'Patch',
  event:       'Event',
};

export default function HomeScreen() {
  const email                 = useAppStore((s) => s.email);
  const openSettings          = useAppStore((s) => s.openSettings);
  const toggleAccountPopover  = useAppStore((s) => s.toggleAccountPopover);
  const launchGame            = useAppStore((s) => s.launchGame);
  const appState              = useAppStore((s) => s.state);

  const announcements   = useContentStore((s) => s.announcements);
  const patchNotes      = useContentStore((s) => s.patchNotes);
  const contentLoading  = useContentStore((s) => s.loading);
  const contentError    = useContentStore((s) => s.error);
  const loadContent     = useContentStore((s) => s.load);

  const [version, setVersion] = useState('');
  const [openPatchNote, setOpenPatchNote] = useState(null);

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  // Load announcements + patch-notes on mount. The store is idempotent
  // (skips if already loading); subsequent home re-mounts (e.g. after
  // a sign-out → sign-in cycle) refetch cleanly.
  useEffect(() => { loadContent(); }, [loadContent]);

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">PROJECT REMNANT</div>

        {/* Realm picker — the chevron + dropdown wire up in PR 5. The
            realm label sits OUTSIDE the chip so the chip itself is
            "the value, click to change." */}
        <div className="home-realm" aria-label="Realm">
          <span className="home-realm-label">Realm</span>
          <button type="button" className="home-realm-chip" disabled>
            <span className="home-realm-name">Test Realm</span>
            <span className="home-realm-chevron" aria-hidden="true">▾</span>
          </button>
        </div>

        <div className="home-header-actions">
          <button
            type="button"
            className="header-icon-btn"
            aria-label={`Account: ${email ?? 'signed in'}`}
            onClick={toggleAccountPopover}
          >
            <span aria-hidden="true">👤</span>
          </button>
          <AccountPopover />
          <button
            type="button"
            className="header-icon-btn"
            aria-label="Settings"
            onClick={openSettings}
          >
            <span aria-hidden="true">⚙</span>
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-content-row">
          <div className="home-content-stack">
            {/* Announcements — primary content. Server returns top 5
                active+unexpired ordered DESC; we render them all. When
                zero rows (or initial load), we omit the section so
                patch notes own more vertical space. */}
            {(announcements.length > 0 || contentLoading) && (
              <section className="home-announcements" aria-labelledby="announcements-heading">
                <div className="home-section-eyebrow" id="announcements-heading">
                  Announcements
                </div>
                <div className="announcements-feed">
                  {contentLoading && announcements.length === 0 && (
                    <article className="announcement plate kind-notice">
                      <p className="announcement-body">
                        <span style={{ color: 'var(--text-muted)' }}>Loading announcements…</span>
                      </p>
                    </article>
                  )}
                  {announcements.map((a) => (
                    <article key={a.id} className={`announcement plate kind-${a.kind}`}>
                      <header className="announcement-meta">
                        <span className="announcement-tag">
                          {KIND_LABELS[a.kind] ?? a.kind}
                        </span>
                        <time className="announcement-date" dateTime={a.created_at}>
                          {relativeDate(a.created_at)}
                        </time>
                      </header>
                      <h3 className="announcement-subject">{a.subject}</h3>
                      {a.body && (
                        <div className="announcement-body">
                          {a.body.split(/\n\n+/).map((para, i) => (
                            <p key={i}>{para}</p>
                          ))}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}

            {/* Patch notes — fixed 3-card grid (server caps at 3).
                Click a card → opens PatchNotesModal with the version's
                full entries[]. */}
            <section className="home-patch-rail" aria-labelledby="patch-rail-heading">
              <div className="home-section-eyebrow" id="patch-rail-heading">
                Patch Notes
              </div>
              <div className="patch-rail-grid">
                {patchNotes.length === 0 && contentLoading && (
                  <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    Loading patch notes…
                  </div>
                )}
                {patchNotes.length === 0 && !contentLoading && !contentError && (
                  <div style={{ gridColumn: '1 / -1', color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>
                    No patch notes published yet.
                  </div>
                )}
                {patchNotes.map((note) => {
                  // Card headline: take the first NEW entry, falling
                  // back to the first entry of any tag, falling back
                  // to the version. Most patch notes start with NEW
                  // entries; this gives a meaningful card subject
                  // without an explicit "card_title" column.
                  const firstNew = note.entries?.find((e) => e.tag === 'NEW');
                  const headline = firstNew?.text
                    ?? note.entries?.[0]?.text
                    ?? `v${note.version}`;
                  return (
                    <button
                      key={note.id}
                      type="button"
                      className="patch-card kind-deploy"
                      onClick={() => setOpenPatchNote(note)}
                    >
                      <div className="patch-card-headline">{headline}</div>
                      <div className="patch-card-meta">
                        <span className="patch-card-version">v{note.version}</span>
                        <span aria-hidden="true">·</span>
                        <span className="patch-card-date">{relativeDate(note.created_at)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
              {contentError && (
                <div style={{ color: 'var(--accent-danger)', fontSize: 'var(--text-xs)', marginTop: 'var(--space-2)' }}>
                  Failed to load content: {contentError}
                </div>
              )}
            </section>
          </div>

          {/* Shared hero — single image at src/renderer/assets/launcher-hero.webp,
              spanning the full content-row height. */}
          <aside
            className="home-hero"
            style={{ backgroundImage: `url(${launcherHeroUrl})` }}
            aria-hidden="true"
          />
        </div>
      </main>

      <footer className="home-footer">
        <button
          type="button"
          className="btn btn-primary play-button"
          onClick={launchGame}
          disabled={appState === 'playing'}
          aria-disabled={appState === 'playing'}
          title={appState === 'playing' ? 'Game is running' : 'Launch the game'}
        >
          {appState === 'playing' ? 'Playing…' : 'Play'}
        </button>
      </footer>

      <SettingsModal />
      {openPatchNote && (
        <PatchNotesModal
          note={openPatchNote}
          onClose={() => setOpenPatchNote(null)}
        />
      )}

      <div className="home-version">v{version || '0.0.0'}</div>
    </div>
  );
}
