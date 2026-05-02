import { useEffect } from 'react';

// Rendered when the spawned game exits non-zero within ~5s of spawn.
// Most common cause: Electron's asar-integrity fuse rejecting a tampered
// or corrupted app.asar. Also catches AV quarantine, missing files,
// broken executables. We can't tell which from the launcher's vantage,
// so the copy is honest about that and the remediation (Repair) is the
// same regardless.
//
// Repair routes through the existing game:forceRepair IPC, which clears
// the active version pointer and triggers a fresh download via the
// standard verify/install path. After repair completes, this modal
// closes and the player can Play normally.
//
// Stateless — `repairing` and `repairError` are passed in from
// HomeScreen, which already observes useGameStore for auto-close.

export default function GameRepairModal({
  failure,
  onClose,
  onRepair,
  repairing = false,
  repairError = null,
}) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !repairing) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, repairing]);

  return (
    <div
      className="modal-scrim"
      onClick={repairing ? undefined : onClose}
      role="presentation"
    >
      <div
        className="plate modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="repair-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-eyebrow">Game</div>
            <h2 id="repair-modal-title" className="modal-title">
              Game failed to start
            </h2>
          </div>
        </div>

        <div className="modal-body">
          <p>
            The game closed before it finished starting up. This usually means
            the install is corrupted or another program modified the game
            files.
          </p>
          <p>
            Repairing will redownload and reinstall the game (~200MB).
          </p>
          {failure?.version && (
            <p className="repair-modal-meta">
              Version {failure.version} · exit code {failure.exitCode}
            </p>
          )}
          {repairError && (
            <div className="form-error" role="alert">
              Repair failed: {repairError}
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={repairing}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onRepair}
            disabled={repairing}
          >
            {repairing ? 'Repairing…' : (repairError ? 'Try again' : 'Repair')}
          </button>
        </div>
      </div>
    </div>
  );
}
