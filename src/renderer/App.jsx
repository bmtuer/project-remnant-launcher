import { useEffect, useRef, useState } from 'react';
import SignIn from './views/SignIn.jsx';
import RealmPicker from './views/RealmPicker.jsx';
import PatchNotes from './views/PatchNotes.jsx';
import Announcements from './views/Announcements.jsx';
import Settings from './views/Settings.jsx';

const VIEWS = [
  { id: 'sign-in',       label: 'Sign In',        Component: SignIn },
  { id: 'realm-picker',  label: 'Realms',         Component: RealmPicker },
  { id: 'patch-notes',   label: 'Patch Notes',    Component: PatchNotes },
  { id: 'announcements', label: 'Announcements',  Component: Announcements },
  { id: 'settings',      label: 'Settings',       Component: Settings },
];

export default function App() {
  const appRef = useRef(null);
  const [activeView, setActiveView] = useState('sign-in');
  const [version, setVersion] = useState('');

  // Rem-scaling. Mirrors project-remnant/src/renderer/App.jsx:144-156, but
  // baselined for the launcher window: 960×640 → 13px root. ResizeObserver
  // adjusts root font-size proportionally so every rem value scales with
  // the window. Min/max clamp prevents the layout from going unreadable
  // at the resize bounds set in main/index.js.
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const scale = Math.min(height / 640, width / 960);
        const baseFontSize = Math.max(11, Math.min(16, scale * 13));
        document.documentElement.style.fontSize = `${baseFontSize}px`;
      }
    });
    if (appRef.current) observer.observe(appRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  // Tray "Sign Out" routes here. PR 2 wires the actual sign-out flow;
  // for now, just navigate to the sign-in view as the visible side-effect.
  useEffect(() => {
    const off = window.launcher?.onSignOutRequested?.(() => {
      setActiveView('sign-in');
    });
    return () => off?.();
  }, []);

  const ActiveComponent = VIEWS.find((v) => v.id === activeView)?.Component ?? SignIn;

  return (
    <div id="app-root" ref={appRef}>
      <nav className="launcher-nav" aria-label="Launcher navigation">
        <div className="launcher-brand">REMNANT</div>
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className={`launcher-nav-item${activeView === v.id ? ' is-active' : ''}`}
            onClick={() => setActiveView(v.id)}
          >
            {v.label}
          </button>
        ))}
        <div className="launcher-nav-spacer" />
        <div className="launcher-version">v{version || '0.0.0'}</div>
      </nav>
      <main className="launcher-main">
        <ActiveComponent />
      </main>
    </div>
  );
}
