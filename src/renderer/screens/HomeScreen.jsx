import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import AccountPopover from '../components/AccountPopover.jsx';
import SettingsModal  from '../components/SettingsModal.jsx';
import launcherHeroUrl from '../assets/launcher-hero.webp';

export default function HomeScreen() {
  const email                 = useAppStore((s) => s.email);
  const openSettings          = useAppStore((s) => s.openSettings);
  const toggleAccountPopover  = useAppStore((s) => s.toggleAccountPopover);
  const launchGame            = useAppStore((s) => s.launchGame);
  const appState              = useAppStore((s) => s.state);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

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
        {/* Two-column layout for the whole content area:
            LEFT  — vertical stack of announcements feed + patch-notes rail
            RIGHT — single shared hero image, spans full content-row height
            Hero is OUTSIDE all scroll containers, so it never moves. */}
        <div className="home-content-row">
          <div className="home-content-stack">
            {/* Announcements feed — primary content. Vertical stack of
                full plates with the entire body rendered inline. No
                dismiss (announcements are communication, not
                notifications). Active + unexpired only; oldest fall
                off via expires_at + the server's 5-row cap. PR 3 swaps
                demo data for real /api/v1/launcher/announcements. */}
            <section className="home-announcements" aria-labelledby="announcements-heading">
              <div className="home-section-eyebrow" id="announcements-heading">
                Announcements
              </div>
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
            </section>

            {/* Patch-notes rail — secondary content. Fixed 3-card grid;
                no scroll. Server caps GET /api/v1/launcher/patch-notes
                at LIMIT 3 (mirrors the 5-cap on announcements). Past
                3 most-recent, history lives in #changelog-staging
                Discord + the public devlog — not in the launcher.
                Click opens the full release notes in a modal (PR 3). */}
            <section className="home-patch-rail" aria-labelledby="patch-rail-heading">
              <div className="home-section-eyebrow" id="patch-rail-heading">
                Patch Notes
              </div>
              <div className="patch-rail-grid">
                <button type="button" className="patch-card kind-deploy">
                  <div className="patch-card-headline">
                    Bags Full + run resolution unification
                  </div>
                  <div className="patch-card-meta">
                    <span className="patch-card-version">v0.7.3</span>
                    <span aria-hidden="true">·</span>
                    <span className="patch-card-date">2 days ago</span>
                  </div>
                </button>
                <button type="button" className="patch-card kind-deploy">
                  <div className="patch-card-headline">
                    Portal redesign Phase 2
                  </div>
                  <div className="patch-card-meta">
                    <span className="patch-card-version">v0.7.2</span>
                    <span aria-hidden="true">·</span>
                    <span className="patch-card-date">5 days ago</span>
                  </div>
                </button>
                <button type="button" className="patch-card kind-deploy">
                  <div className="patch-card-headline">
                    Site redesign + identity cleanup
                  </div>
                  <div className="patch-card-meta">
                    <span className="patch-card-version">v0.7.1</span>
                    <span aria-hidden="true">·</span>
                    <span className="patch-card-date">1 week ago</span>
                  </div>
                </button>
              </div>
            </section>
          </div>

          {/* Shared hero — single image at src/renderer/assets/launcher-hero.webp,
              spanning the full content-row height. Vite imports the file
              + fingerprints the URL; the inline style sets it as the
              outermost background layer, with token-tinted radial
              gradients overlaid in CSS to harmonize the image into the
              warm-purple chrome. Aria-hidden — the image is purely
              decorative; the announcements feed carries the meaning. */}
          <aside
            className="home-hero"
            style={{ backgroundImage: `url(${launcherHeroUrl})` }}
            aria-hidden="true"
          />
        </div>
      </main>

      <footer className="home-footer">
        {/* PR 2 wires the spawn path; PR 5 adds the version-gate sequence
            (check realm latest_version, run differential update, then
            spawn). Today, clicking Play attempts to spawn the game from
            %APPDATA%/RemnantLauncher/game/test/RemnantGame.exe — the
            binary doesn't exist yet (PR 5 ships it), so spawn surfaces
            a GAME_BINARY_MISSING error in the console. The auth +
            stdin handoff path is fully wired and works once a game
            binary lands at the expected path (e.g. via manual copy
            for early dev). */}
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

      <div className="home-version">v{version || '0.0.0'}</div>
    </div>
  );
}
