import { useEffect, useState } from 'react';
import { useAppStore, useIsLauncherStale } from '../store/appStore.js';
import { SITE_URLS } from '../constants.js';

export default function AuthScreen() {
  const signIn       = useAppStore((s) => s.signIn);
  const busy         = useAppStore((s) => s.signInBusy);
  const error        = useAppStore((s) => s.signInError);
  const updateStatus = useAppStore((s) => s.update.status);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [version, setVersion]   = useState('');

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  // Server says this launcher version is below min_required_launcher_version.
  // We replace the sign-in card with an update-required message; sign-in
  // is structurally unavailable until the player runs the self-update.
  // Selector returns false until /status has resolved + version is known,
  // so we don't flash this gate during boot.
  const stale = useIsLauncherStale(version);

  const onSubmit = (e) => {
    e.preventDefault();
    if (busy) return;
    signIn(email, password);
  };

  const openExternal = (url) => (e) => {
    e.preventDefault();
    window.launcher?.openExternal(url);
  };

  const onRestart = () => window.launcher?.updater?.quitAndInstall();

  return (
    <div className="auth-screen">
      <div className="auth-stack">
        <div className="auth-brand">PROJECT REMNANT</div>

        {stale ? <StaleLauncherCard
                    updateStatus={updateStatus}
                    onRestart={onRestart}
                  />
              : <SignInCard
                    email={email}
                    setEmail={setEmail}
                    password={password}
                    setPassword={setPassword}
                    onSubmit={onSubmit}
                    busy={busy}
                    error={error}
                    openExternal={openExternal}
                  />}

        {/* Server-status strip — PR 5 wires real /api/v1/launcher/realms data.
            Static placeholder for now so the layout reads correctly. */}
        <div className="auth-server-strip">
          <span className="status-dot status-dot-online" aria-hidden="true" />
          Test Realm — checking…
        </div>
      </div>

      <div className="auth-version">v{version || '0.0.0'}</div>
    </div>
  );
}

// Normal sign-in card. Default render; player can authenticate.
function SignInCard({ email, setEmail, password, setPassword, onSubmit, busy, error, openExternal }) {
  return (
    <form className="plate auth-card" onSubmit={onSubmit} noValidate>
      <label className="auth-field">
        <span className="auth-label">Email</span>
        <input
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          required
        />
      </label>
      <label className="auth-field">
        <span className="auth-label">Password</span>
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
          required
        />
      </label>

      {error && <div className="auth-error" role="alert">{error}</div>}

      <button type="submit" className="btn btn-primary auth-submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign In'}
      </button>

      <div className="auth-footer-links">
        <a href={SITE_URLS.signUp} onClick={openExternal(SITE_URLS.signUp)}>
          Create Account
        </a>
        <span aria-hidden="true">·</span>
        <a href={SITE_URLS.forgotPassword} onClick={openExternal(SITE_URLS.forgotPassword)}>
          Forgot Password
        </a>
      </div>
    </form>
  );
}

// Stale-launcher gate. Renders when the installed launcher version
// is below the server's min_required_launcher_version. Sign-in is
// not available — player must run the self-update. The button
// label + behavior depend on electron-updater's current state:
//   - ready    → "Restart & Install" (download finished, just apply)
//   - progress → "Downloading update…" (in-progress, no action yet)
//   - else     → "Waiting for update…" (auto-download about to start
//                or already-checked & up-to-date even though server
//                says we're stale, which means a release is rolling
//                out and we'll catch the next check)
function StaleLauncherCard({ updateStatus, onRestart }) {
  const ready = updateStatus === 'ready';
  const progressing = updateStatus === 'progress';
  return (
    <div className="plate auth-card auth-card-stale" role="alert">
      <div className="auth-stale-eyebrow">Launcher update required</div>
      <p className="auth-stale-body">
        Your launcher needs to update before you can sign in.
        {ready && ' The update is downloaded and ready.'}
        {progressing && ' Downloading the update now…'}
        {!ready && !progressing && ' Checking for the update…'}
      </p>
      <button
        type="button"
        className="btn btn-primary auth-submit"
        onClick={onRestart}
        disabled={!ready}
      >
        {ready ? 'Restart & Install' : 'Waiting for update…'}
      </button>
    </div>
  );
}
