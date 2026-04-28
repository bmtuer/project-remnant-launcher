import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { useContentStore } from '../store/contentStore.js';
import { useRealmStore, useActiveRealm } from '../store/realmStore.js';
import { useGameStore } from '../store/gameStore.js';
import AccountPopover from '../components/AccountPopover.jsx';
import SettingsModal  from '../components/SettingsModal.jsx';
import PatchNotesModal from '../components/PatchNotesModal.jsx';
import { AccountIcon, SettingsIcon } from '../components/icons.jsx';
import launcherHeroUrl from '../assets/launcher-hero.webp';
import { relativeDate } from '../utils/relativeDate.js';

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

  const realms          = useRealmStore((s) => s.realms);
  const selectedRealmId = useRealmStore((s) => s.selectedRealmId);
  const selectRealm     = useRealmStore((s) => s.selectRealm);
  const loadRealms      = useRealmStore((s) => s.load);
  const activeRealm     = useActiveRealm();

  const installedVersionByEnv = useGameStore((s) => s.installedVersionByEnv);
  const updateState           = useGameStore((s) => s.update);
  const verifyOrInstallActive = useGameStore((s) => s.verifyOrInstallActive);
  const loadInstalledVersion  = useGameStore((s) => s.loadInstalledVersion);

  const [openPatchNote, setOpenPatchNote] = useState(null);

  // Mount: load content + realms + installed version.
  useEffect(() => { loadContent(); }, [loadContent]);
  useEffect(() => { loadRealms(); }, [loadRealms]);
  useEffect(() => {
    if (selectedRealmId) loadInstalledVersion(selectedRealmId);
  }, [selectedRealmId, loadInstalledVersion]);

  // Background verify/install on home mount + on realm change. The
  // main-process session cache makes the second-onwards call cheap
  // (just a manifest fetch + version-string compare). On a fresh
  // launcher boot or a different realm with no install, this is the
  // path that downloads the game binary.
  useEffect(() => {
    if (appState !== 'home') return;
    if (!selectedRealmId) return;
    verifyOrInstallActive();
  }, [appState, selectedRealmId, verifyOrInstallActive]);

  const installedVersion = selectedRealmId ? installedVersionByEnv[selectedRealmId] : null;

  // ── Play button state machine ─────────────────────────────────
  // Folds: realm status, app-state (playing / not), update phase,
  // and version-vs-installed comparison into a single discriminator.
  const playStatus = derivePlayStatus({
    appState,
    activeRealm,
    updatePhase: updateState.phase,
    updatePercent: updateState.percent,
  });

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">PROJECT REMNANT</div>

        <div className="home-realm" aria-label="Realm">
          <span className="home-realm-label">Realm</span>
          <RealmSelect
            realms={realms}
            value={selectedRealmId}
            onChange={selectRealm}
            activeRealm={activeRealm}
          />
        </div>

        <div className="home-header-actions">
          <button
            type="button"
            className="header-icon-btn"
            aria-label={`Account: ${email ?? 'signed in'}`}
            onClick={toggleAccountPopover}
          >
            <AccountIcon />
          </button>
          <AccountPopover />
          <button
            type="button"
            className="header-icon-btn"
            aria-label="Settings"
            onClick={openSettings}
          >
            <SettingsIcon />
          </button>
        </div>
      </header>

      <main className="home-main">
        <div className="home-content-row">
          <div className="home-content-stack">
            {(announcements.length > 0 || contentLoading) && (
              <section className="home-announcements" aria-labelledby="announcements-heading">
                <div className="home-section-eyebrow" id="announcements-heading">
                  Announcements
                </div>
                <div className="announcements-feed">
                  {contentLoading && announcements.length === 0 && (
                    <article className="announcement plate kind-notice" aria-busy="true">
                      <span className="skeleton-line is-short" />
                      <span className="skeleton-line is-medium" />
                      <span className="skeleton-line" />
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

            <section className="home-patch-rail" aria-labelledby="patch-rail-heading">
              <div className="home-section-eyebrow" id="patch-rail-heading">
                Patch Notes
              </div>
              <div className="patch-rail-grid">
                {patchNotes.length === 0 && contentLoading && (
                  <>
                    <div className="patch-card patch-card-skeleton" aria-busy="true">
                      <span className="skeleton-line is-short" />
                      <span className="skeleton-line is-medium" />
                    </div>
                    <div className="patch-card patch-card-skeleton" aria-busy="true">
                      <span className="skeleton-line is-short" />
                      <span className="skeleton-line is-medium" />
                    </div>
                    <div className="patch-card patch-card-skeleton" aria-busy="true">
                      <span className="skeleton-line is-short" />
                      <span className="skeleton-line is-medium" />
                    </div>
                  </>
                )}
                {patchNotes.length === 0 && !contentLoading && !contentError && (
                  <div className="patch-rail-empty">
                    <div className="empty-state">
                      <div className="empty-state-eyebrow">No patch notes</div>
                      <p className="empty-state-body">Nothing published yet — check back after the next release.</p>
                    </div>
                  </div>
                )}
                {patchNotes.map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    className="patch-card"
                    onClick={() => setOpenPatchNote(note)}
                  >
                    <div className="patch-card-version">v{note.version}</div>
                    <div className="patch-card-date">{relativeDate(note.created_at)}</div>
                  </button>
                ))}
              </div>
              {contentError && (
                <div className="form-error form-error-sm" role="alert">
                  Failed to load content: {contentError}
                </div>
              )}
            </section>
          </div>

          <aside
            className="home-hero"
            style={{ backgroundImage: `url(${launcherHeroUrl})` }}
            aria-hidden="true"
          />
        </div>
      </main>

      <footer className="home-footer">
        {/* Progress strip — only renders during active update flows.
            When idle/done, the footer just has the Play button on
            the right. */}
        <UpdateProgressStrip update={updateState} />
        <button
          type="button"
          className={`btn play-button ${playStatus.btnClass}`}
          onClick={() => {
            if (playStatus.disabled) return;
            launchGame();
          }}
          disabled={playStatus.disabled}
          aria-disabled={playStatus.disabled}
          title={playStatus.title}
        >
          {playStatus.label}
        </button>
      </footer>

      <SettingsModal />
      {openPatchNote && (
        <PatchNotesModal
          note={openPatchNote}
          onClose={() => setOpenPatchNote(null)}
        />
      )}

      {/* Bottom-left corner — game version readout. Mirrors the launcher
          version's prior placement; this slot now carries what players
          actually look for ("am I on v0.7.4?"). Empty until a game has
          been installed. */}
      {installedVersion && (
        <div className="home-game-version" aria-label={`Game version ${installedVersion}`}>
          Game v{installedVersion}
        </div>
      )}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Realm <select> — uses a native select so dropdown chrome is OS-
 *  correct. Wrapped with a positioned status dot that sits inside the
 *  chip's left padding (Battle.net pattern). Status colors come from
 *  the same status-dot-* classes as AuthScreen's server strip. */
function RealmSelect({ realms, value, onChange, activeRealm }) {
  if (realms.length === 0) {
    // Pre-fetch / fetch-failed: render a skeleton-shaped placeholder
    // so the layout doesn't shift when realms load.
    return (
      <div className="home-realm-chip-wrap">
        <button type="button" className="home-realm-chip" disabled aria-busy="true">
          <span style={{ display: 'inline-block', width: '5rem' }}>
            <span className="skeleton-line" style={{ height: '0.7rem' }} />
          </span>
        </button>
      </div>
    );
  }
  const status = activeRealm?.status ?? 'unknown';
  const dotClass = {
    online:      'status-dot-online',
    maintenance: 'status-dot-maintenance',
    offline:     'status-dot-offline',
  }[status] ?? 'status-dot-offline';
  return (
    <div className="home-realm-chip-wrap">
      <span
        className={`status-dot home-realm-dot ${dotClass}`}
        role="img"
        aria-label={`Status: ${status}`}
      />
      <select
        className="home-realm-chip home-realm-select has-status"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {realms.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Footer progress strip. Renders during active update phases; hidden
 *  when idle / done / error. accent-info bar over bg-recessed track,
 *  matches the LauncherUpdateBanner from PR 4 for visual consistency
 *  across the two update flows. */
function UpdateProgressStrip({ update }) {
  const { phase, percent, downloaded, total, version } = update;
  if (phase === 'idle' || phase === 'done') return null;

  const labelByPhase = {
    manifest:   'Checking for updates…',
    verifying:  'Verifying files…',
    downloading: version ? `Downloading v${version}…` : 'Downloading update…',
    installing: 'Installing…',
    error:      'Update failed',
  };
  const label = labelByPhase[phase] ?? '';

  // "downloading" + "installing" can show real percent. Other phases
  // get an indeterminate shimmer (no percent rendered).
  const showPercent = phase === 'downloading' || phase === 'installing';
  const showIndeterminate = phase === 'manifest' || phase === 'verifying';

  return (
    <div className="home-update-strip" role="status" aria-live="polite">
      <span className="home-update-label">{label}</span>
      <div className={`home-update-track${showIndeterminate ? ' is-indeterminate' : ''}`} aria-hidden="true">
        <div
          className="home-update-fill"
          style={showPercent ? { width: `${percent ?? 0}%` } : undefined}
        />
      </div>
      {showPercent && (
        <span className="home-update-percent">
          {percent ?? 0}%
          {downloaded > 0 && total > 0 && (
            <>
              {' · '}
              <span className="home-update-bytes">
                {fmtMB(downloaded)} / {fmtMB(total)}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function fmtMB(bytes) {
  if (!bytes) return '0 MB';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}

/** Decide the Play button's text + disabled state + title from the
 *  combined launcher+realm+update state. Pure function — easy to test. */
function derivePlayStatus({ appState, activeRealm, updatePhase, updatePercent }) {
  if (appState === 'playing') {
    return { label: 'Playing…', disabled: true, btnClass: 'btn-secondary',
             title: 'Game is running' };
  }

  // Realm-status gates BEFORE update gates — if the realm is down,
  // a green binary doesn't help.
  const realmStatus = activeRealm?.status ?? null;
  if (realmStatus === 'maintenance') {
    return { label: 'Maintenance', disabled: true, btnClass: 'btn-secondary',
             title: 'Server is in maintenance mode' };
  }
  if (realmStatus === 'offline') {
    return { label: 'Offline', disabled: true, btnClass: 'btn-secondary',
             title: 'Server is offline' };
  }

  // Update gates.
  if (updatePhase === 'manifest' || updatePhase === 'verifying') {
    return { label: 'Verifying…', disabled: true, btnClass: 'btn-primary',
             title: 'Checking game files…' };
  }
  if (updatePhase === 'downloading') {
    const pct = updatePercent ?? 0;
    return { label: `Updating ${pct}%`, disabled: true, btnClass: 'btn-primary',
             title: `Downloading update (${pct}%)` };
  }
  if (updatePhase === 'installing') {
    return { label: 'Installing…', disabled: true, btnClass: 'btn-primary',
             title: 'Installing update…' };
  }
  if (updatePhase === 'error') {
    return { label: 'Retry', disabled: false, btnClass: 'btn-primary',
             title: 'Last update failed — click to retry' };
  }

  // No realm yet (loading), no update in progress, no error — disabled.
  if (!activeRealm) {
    return { label: 'Play', disabled: true, btnClass: 'btn-primary',
             title: 'Loading realm list…' };
  }

  // Happy path.
  return { label: 'Play', disabled: false, btnClass: 'btn-primary',
           title: 'Launch the game' };
}
