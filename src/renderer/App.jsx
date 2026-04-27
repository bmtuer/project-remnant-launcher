import { useEffect, useRef } from 'react';
import { useAppStore }  from './store/appStore.js';
import BootScreen from './screens/BootScreen.jsx';
import AuthScreen from './screens/AuthScreen.jsx';
import HomeScreen from './screens/HomeScreen.jsx';
import LauncherUpdateBanner from './components/LauncherUpdateBanner.jsx';

export default function App() {
  const appRef  = useRef(null);
  const state           = useAppStore((s) => s.state);
  const hydrate         = useAppStore((s) => s.hydrate);
  const signOut         = useAppStore((s) => s.signOut);
  const setUpdateStatus = useAppStore((s) => s.setUpdateStatus);

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

  // Launcher self-update events. Subscribe once at boot; main fires
  // `launcher:update-status` for the lifecycle of each check.
  useEffect(() => {
    const off = window.launcher?.updater?.onUpdateStatus?.((payload) => {
      setUpdateStatus(payload);
    });
    return () => off?.();
  }, [setUpdateStatus]);

  // Game lifecycle subscriptions — fire once at boot. The game-spawner
  // dispatches exit codes via the `game:exited` event; we route on the
  // code so the player lands in the right state when the game window
  // closes:
  //   0 normal             → home (game closed cleanly)
  //   1 crash              → home + future toast (PR 5 polishes the message)
  //   2 version-mismatch   → home + PR 5 will trigger the game-update flow
  //   3 auth-expired       → auth (re-sign-in needed)
  //   4 server-unreachable → home + PR 5 toasts the realm status
  // All paths return us to a non-`playing` state — the launcher window
  // is already restored by main when the child exits.
  useEffect(() => {
    const offExit = window.launcher?.game?.onExit?.((payload) => {
      const code = payload?.code ?? 0;
      if (code === 3) {
        signOut();
      } else {
        useAppStore.setState({ state: 'home' });
      }
    });
    const offError = window.launcher?.game?.onSpawnError?.((payload) => {
      // PR 5 will surface a toast here. For PR 2 the console is fine —
      // the most-common error in PR 2 is GAME_BINARY_MISSING, which is
      // expected (binary distribution lands in PR 5).
      console.warn('[launcher] game spawn error:', payload?.code, payload?.message);
      useAppStore.setState({ state: 'home' });
    });
    return () => {
      offExit?.();
      offError?.();
    };
  }, [signOut]);

  let screen;
  if (state === 'boot') screen = <BootScreen />;
  else if (state === 'home') screen = <HomeScreen />;
  else screen = <AuthScreen />;

  return (
    <div id="app-root" ref={appRef}>
      <LauncherUpdateBanner />
      {screen}
    </div>
  );
}
