import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import AccountPopover from '../components/AccountPopover.jsx';
import SettingsModal  from '../components/SettingsModal.jsx';

export default function HomeScreen() {
  const email                 = useAppStore((s) => s.email);
  const openSettings          = useAppStore((s) => s.openSettings);
  const toggleAccountPopover  = useAppStore((s) => s.toggleAccountPopover);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  return (
    <div className="home-screen">
      <header className="home-header">
        <div className="home-brand">REMNANT</div>

        {/* Realm picker — PR 5 turns this into a real dropdown sourced from
            /api/v1/launcher/realms. Static placeholder for now. */}
        <div className="home-realm-picker" aria-label="Realm">
          <span className="realm-label">Realm</span>
          <span className="realm-name">Test Realm</span>
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
        {/* Announcements feed — primary content. Vertical stack of full
            plates with the entire body text rendered inline. No dismiss
            (announcements are communication, not notifications). Active +
            unexpired only; oldest fall off via the `expires_at` column.
            Empty state: when zero active announcements, the section
            collapses entirely and patch notes take over the full main
            scroll. PR 3 swaps demo data for real /api/v1/launcher/announcements. */}
        <section className="home-announcements" aria-labelledby="announcements-heading">
          <div className="home-section-eyebrow" id="announcements-heading">
            Announcements
          </div>

          {/* Two-column row: scrollable feed on the left, single shared
              hero image on the right. The hero is global to the
              launcher (one image, set in /assets/launcher-hero.webp or
              similar), not per-announcement. PR 3's schema therefore
              does NOT add a per-row hero_image_url — the hero is a
              build-time launcher asset. */}
          <div className="announcements-row">
            <div className="announcements-feed">
              <article className="announcement plate kind-maintenance">
                <header className="announcement-meta">
                  <span className="announcement-tag">Maintenance</span>
                  <time className="announcement-date" dateTime="2026-05-02">
                    Sat 2pm UTC
                  </time>
                </header>
                <h3 className="announcement-subject">Scheduled server restart</h3>
                <div className="announcement-body">
                  <p>
                    Server is restarting Saturday at 2pm UTC for the v0.7.3
                    deployment. Expect ~10 minutes of downtime.
                  </p>
                  <p>
                    Active runs will be auto-resolved; loot you've already
                    accepted is safe in your inventory. If you're mid-run when
                    the restart hits, you'll wake up with a system mail
                    summarizing what happened.
                  </p>
                </div>
              </article>

              <article className="announcement plate kind-deploy">
                <header className="announcement-meta">
                  <span className="announcement-tag">Deploy</span>
                  <time className="announcement-date" dateTime="2026-04-26">
                    yesterday
                  </time>
                </header>
                <h3 className="announcement-subject">Bags Full + run resolution shipped</h3>
                <div className="announcement-body">
                  <p>
                    v0.7.2 ships the unified post-run summary screen with
                    Spoils / Transfer / Stash, replacing the old confirm
                    screen. Plus a 5-minute auto-resolve sweep for abandoned
                    runs so nothing gets stuck in limbo.
                  </p>
                  <p>
                    Please report any drag-and-drop issues with the loot
                    grid — we caught most cases but a clean staging soak
                    helps surface the rest.
                  </p>
                </div>
              </article>

              <article className="announcement plate kind-notice">
                <header className="announcement-meta">
                  <span className="announcement-tag">Notice</span>
                  <time className="announcement-date" dateTime="2026-04-24">
                    3 days ago
                  </time>
                </header>
                <h3 className="announcement-subject">Newsletter signups open</h3>
                <div className="announcement-body">
                  <p>
                    Sign up at project-remnant.com for devlog posts and
                    pre-launch updates. Closed beta is still active —
                    public sign-ups land when we flip the gate, but you
                    can subscribe to the newsletter anytime.
                  </p>
                </div>
              </article>
            </div>

            {/* Shared hero — Bryan generates a single image at v1; later
                we may rotate per realm or season. Build-time asset, not
                per-announcement data. */}
            <aside className="announcements-hero" aria-hidden="true" />
          </div>
        </section>

        {/* Patch notes rail — secondary content. Compact version cards in
            a horizontal scroller; click a card to open the full release
            notes in a modal (PR 3). When zero patch-notes (rare), section
            collapses. */}
        <section className="home-patch-rail" aria-labelledby="patch-rail-heading">
          <div className="home-section-eyebrow" id="patch-rail-heading">
            Patch Notes
          </div>
          <div className="patch-rail-scroller">
            <button type="button" className="patch-card">
              <div className="patch-card-version">v0.7.3</div>
              <div className="patch-card-date">2 days ago</div>
              <div className="patch-card-headline">
                Bags Full + run resolution unification
              </div>
            </button>
            <button type="button" className="patch-card">
              <div className="patch-card-version">v0.7.2</div>
              <div className="patch-card-date">5 days ago</div>
              <div className="patch-card-headline">
                Portal redesign Phase 2
              </div>
            </button>
            <button type="button" className="patch-card">
              <div className="patch-card-version">v0.7.1</div>
              <div className="patch-card-date">1 week ago</div>
              <div className="patch-card-headline">
                Site redesign + identity cleanup
              </div>
            </button>
            <button type="button" className="patch-card">
              <div className="patch-card-version">v0.7.0</div>
              <div className="patch-card-date">2 weeks ago</div>
              <div className="patch-card-headline">
                Identity Supabase bootstrap
              </div>
            </button>
          </div>
        </section>
      </main>

      <footer className="home-footer">
        <button
          type="button"
          className="btn btn-primary play-button"
          disabled
          aria-disabled="true"
          title="Play sequence wires up in PR 5"
        >
          Play
        </button>
      </footer>

      <SettingsModal />

      {/* Version pinned bottom-right of header strip's row, but
          mirrored as a faint bottom-right corner readout for parity with
          AuthScreen. */}
      <div className="home-version">v{version || '0.0.0'}</div>
    </div>
  );
}
