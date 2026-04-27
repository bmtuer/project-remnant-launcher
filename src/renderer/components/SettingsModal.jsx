import { useEffect, useState } from 'react';
import { useAppStore } from '../store/appStore.js';

// Sign-out lives ONLY in the account popover — single canonical path.
// Settings is a settings panel; duplicating destructive actions across
// surfaces is friction without value.
//
// Settings body covers four controls per the launcher-split plan:
//   - Auto-launch on Windows startup (toggle)
//   - Close-X behavior (radio: minimize to tray / quit)
//   - Default realm on launch (dropdown — single option until PR 5
//     wires real realm data; "Last used realm" is the only meaningful
//     choice today)
//   - Repair Game (button — disabled until PR 5 ships the game-binary
//     installer + sha512 verify path)
//
// Each control writes its change immediately via window.launcher.settings.set —
// no Save button. The settings file in userData survives launcher
// self-updates so values persist across reinstalls.

export default function SettingsModal() {
  const open  = useAppStore((s) => s.settingsOpen);
  const close = useAppStore((s) => s.closeSettings);

  const [settings, setSettings] = useState(null);
  const [busyKey, setBusyKey]   = useState(null);  // key currently being saved
  const [error, setError]       = useState(null);
  const [version, setVersion]   = useState('');

  // Read launcher version once on first open. Used in the modal
  // footer; surfaces here instead of in the launcher's bottom-left
  // corner (that real estate is reserved for the GAME version once
  // PR 5 wires the game-binary install path).
  useEffect(() => {
    if (!open) return;
    window.launcher?.getVersion().then(setVersion).catch(() => setVersion(''));
  }, [open]);

  // Load settings on first open (and re-load each subsequent open
  // in case main mutated them between sessions). Cheap fetch — IPC
  // round-trip + a JSON parse.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await window.launcher.settings.get();
        if (!cancelled) setSettings(data);
      } catch (err) {
        if (!cancelled) setError(err?.message ?? 'Failed to load settings.');
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  // Apply a single-key patch + persist. Optimistic UI — set the new
  // value immediately so the toggle/radio reflects user intent, then
  // write to disk. On error, revert + surface the message.
  async function update(key, value) {
    if (!settings) return;
    const prev = settings[key];
    setSettings((s) => ({ ...s, [key]: value }));
    setBusyKey(key);
    setError(null);
    try {
      const next = await window.launcher.settings.set({ [key]: value });
      setSettings(next);
    } catch (err) {
      // Revert on failure.
      setSettings((s) => ({ ...s, [key]: prev }));
      setError(err?.message ?? 'Failed to save setting.');
    } finally {
      setBusyKey(null);
    }
  }

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
          {/* No eyebrow — the heading carries the label on its own.
              Eyebrow vocabulary is reserved for content modals like
              PatchNotesModal where the eyebrow + heading carry
              different information ("PATCH NOTES" / "v0.7.3"). On a
              utility modal that's just "settings," the eyebrow
              duplicates the heading. */}
          <h2 id="settings-title" className="modal-title">Launcher Settings</h2>
          <button
            type="button"
            className="modal-close"
            onClick={close}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="modal-body settings-body">
          {!settings ? (
            <p className="placeholder-body">Loading…</p>
          ) : (
            <>
              {/* Auto-launch on Windows startup */}
              <SettingRow label="Launch on startup">
                <ToggleSwitch
                  checked={settings.autoLaunchOnStartup}
                  busy={busyKey === 'autoLaunchOnStartup'}
                  onChange={(checked) => update('autoLaunchOnStartup', checked)}
                />
              </SettingRow>

              {/* Close-X behavior */}
              <SettingRow label="Close button">
                <RadioGroup
                  name="closeXBehavior"
                  value={settings.closeXBehavior}
                  busy={busyKey === 'closeXBehavior'}
                  onChange={(v) => update('closeXBehavior', v)}
                  options={[
                    { value: 'tray', label: 'Minimize' },
                    { value: 'quit', label: 'Quit' },
                  ]}
                />
              </SettingRow>

              {/* Default realm */}
              <SettingRow label="Default realm">
                <select
                  className="settings-select"
                  value={settings.defaultRealm}
                  disabled={busyKey === 'defaultRealm'}
                  onChange={(e) => update('defaultRealm', e.target.value)}
                >
                  <option value="last-used">Last used realm</option>
                  {/* PR 5 wires real per-realm options here. */}
                </select>
              </SettingRow>

              {/* Window size — applies live. Three discrete presets:
                  Compact (960×640), Standard (1120×720), Large
                  (1280×800). Content rem-scales against the 960×640
                  baseline so each preset reads correctly. */}
              <SettingRow label="Window size">
                <select
                  className="settings-select"
                  value={settings.windowSize}
                  disabled={busyKey === 'windowSize'}
                  onChange={(e) => update('windowSize', e.target.value)}
                >
                  <option value="compact">Compact (960 × 640)</option>
                  <option value="standard">Standard (1120 × 720)</option>
                  <option value="large">Large (1280 × 800)</option>
                </select>
              </SettingRow>

              {/* Repair Game — placeholder until PR 5 ships the
                  game-binary installer + sha512 verify path. The
                  button is wired for future use; today it's disabled. */}
              <SettingRow
                label="Repair game"
                hint="Verify and restore game files."
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled
                  aria-disabled="true"
                  title="Coming in a future update"
                >
                  Repair…
                </button>
              </SettingRow>

              {error && (
                <div className="settings-error" role="alert">{error}</div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer settings-footer">
          {/* Quiet launcher-version readout. Lives here (not in the
              launcher's bottom-left corner) so the corner real estate
              can carry the GAME version once PR 5 wires the binary
              install path. Anyone debugging or filing a support ticket
              opens Settings → reads the version. */}
          <div className="settings-version" aria-label={`Launcher version ${version || 'unknown'}`}>
            v{version || '0.0.0'}
          </div>
          <button type="button" className="btn btn-primary" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Reusable row — label/hint stacked left, control on the right.
function SettingRow({ label, hint, children }) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-label">{label}</div>
        {hint && <div className="settings-row-hint">{hint}</div>}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

// Lightweight toggle switch — visual on/off, no busy spinner; the
// action completes in <50ms on disk + login-items sync, fast enough
// that a spinner adds more flicker than it removes.
function ToggleSwitch({ checked, busy, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`settings-toggle${checked ? ' is-on' : ''}`}
      disabled={busy}
      onClick={() => onChange(!checked)}
    >
      <span className="settings-toggle-track" aria-hidden="true">
        <span className="settings-toggle-thumb" />
      </span>
    </button>
  );
}

// Radio group rendered as horizontal buttons (avoids stock radio chrome,
// matches the launcher's chiseled-button visual register).
function RadioGroup({ name, value, options, busy, onChange }) {
  return (
    <div className="settings-radio-group" role="radiogroup">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          name={name}
          className={`settings-radio${value === opt.value ? ' is-active' : ''}`}
          disabled={busy}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
