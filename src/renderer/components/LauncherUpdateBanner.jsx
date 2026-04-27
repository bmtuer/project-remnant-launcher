import { useAppStore } from '../store/appStore.js';

// Sticks to the top of the launcher window when a self-update is
// available, downloading, or ready to install. Renders above all
// screens (boot/auth/home) — pre-auth visibility is intentional so
// a stale launcher can't sign in to a server with a bumped
// MIN_REQUIRED_LAUNCHER_VERSION (future).
//
// Three visible states (driven by appStore.update.status):
//   `available` — update detected, download starting
//   `progress`  — downloading, % bar visible
//   `ready`     — downloaded, "Restart & Install" button enabled
//
// `idle` / `checking` / `up-to-date` / `error` render nothing.
// We deliberately don't surface "checking…" so the banner doesn't
// flash on every launcher boot.

export default function LauncherUpdateBanner() {
  const { status, version, progress } = useAppStore((s) => s.update);

  if (status !== 'available' && status !== 'progress' && status !== 'ready') {
    return null;
  }

  const onRestart = () => window.launcher?.updater?.quitAndInstall();

  return (
    <div className="update-banner" role="status" aria-live="polite">
      {status === 'available' && (
        <span>
          Launcher update {version ? `v${version} ` : ''}available — preparing download…
        </span>
      )}
      {status === 'progress' && (
        <>
          <span>
            Downloading launcher update{version ? ` v${version}` : ''}…
          </span>
          <div className="update-banner-progress" aria-hidden="true">
            <div
              className="update-banner-progress-fill"
              style={{ width: `${progress ?? 0}%` }}
            />
          </div>
          <span className="update-banner-percent">{progress ?? 0}%</span>
        </>
      )}
      {status === 'ready' && (
        <>
          <span>
            Launcher update {version ? `v${version} ` : ''}ready.
          </span>
          <button type="button" className="update-banner-action" onClick={onRestart}>
            Restart & Install
          </button>
        </>
      )}
    </div>
  );
}
