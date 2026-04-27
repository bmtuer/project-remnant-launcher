import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';
import { SITE_URLS } from '../constants.js';

export default function AuthScreen() {
  const signIn       = useAppStore((s) => s.signIn);
  const busy         = useAppStore((s) => s.signInBusy);
  const error        = useAppStore((s) => s.signInError);
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [version, setVersion]   = useState('');

  useEffect(() => {
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    if (busy) return;
    signIn(email, password);
  };

  const openExternal = (url) => (e) => {
    e.preventDefault();
    window.launcher?.openExternal(url);
  };

  return (
    <div className="auth-screen">
      <div className="auth-stack">
        <div className="auth-brand">PROJECT REMNANT</div>

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
