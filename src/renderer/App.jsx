import { useEffect, useRef } from 'react';
import { useAppStore }  from './store/appStore.js';
import BootScreen from './screens/BootScreen.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import HomeScreen from './screens/HomeScreen.jsx';

export default function App() {
  const appRef  = useRef(null);
  const state   = useAppStore((s) => s.state);
  const hydrate = useAppStore((s) => s.hydrate);
  const signOut = useAppStore((s) => s.signOut);

  // Rem-scaling — mirrors project-remnant/src/renderer/App.jsx:144-156
  // baselined for the launcher window: 960×640 → 13px root. Min/max clamp
  // keeps text readable across the resize bounds set in main/index.js.
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

  // Boot — try to restore a session from main-process storage. On miss /
  // expired / decrypt-failure, transitions to `auth`. On success, `home`.
  useEffect(() => { hydrate(); }, [hydrate]);

  // Tray "Sign Out" routes here.
  useEffect(() => {
    const off = window.launcher?.onSignOutRequested?.(() => signOut());
    return () => off?.();
  }, [signOut]);

  let screen;
  if (state === 'boot') screen = <BootScreen />;
  else if (state === 'home') screen = <HomeScreen />;
  else screen = <AuthScreen />;

  return (
    <div id="app-root" ref={appRef}>
      {screen}
    </div>
  );
}
