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
        {/* Announcements stack — PR 3 fills with real data + dismiss UI.
            When zero undismissed announcements, this section omits entirely
            (no empty-state chrome). For now: omitted by default. */}

        <section className="home-section">
          <div className="home-section-eyebrow">Patch Notes</div>
          <div className="plate placeholder-pane">
            <p className="placeholder-body">
              Patch notes from <code>GET /api/v1/launcher/patch-notes</code>
              render here in PR 3.
            </p>
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
