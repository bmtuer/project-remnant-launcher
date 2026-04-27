import { useEffect } from 'react';
import { useAppStore } from '../store/appStore.js';

export default function SettingsModal() {
  const open    = useAppStore((s) => s.settingsOpen);
  const close   = useAppStore((s) => s.closeSettings);
  const signOut = useAppStore((s) => s.signOut);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="modal-scrim"
      onClick={close}
      role="presentation"
    >
      <div
        className="plate modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-eyebrow">Settings</div>
            <h2 id="settings-title" className="modal-title">Launcher Settings</h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={close}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="placeholder-body">
            Settings body (auto-launch, close-X behavior, default realm,
            repair, sign-out) lands in PR 4. PR 2 ships the trigger + the
            modal scaffolding only.
          </p>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-secondary" onClick={close}>
            Close
          </button>
          <button type="button" className="btn btn-primary" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
