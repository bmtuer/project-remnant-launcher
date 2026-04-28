import { useEffect } from 'react';

// Rendered when the player clicks a patch-notes card on the home
// screen. Shows the version's full entries[] list — each entry is
// { tag, text } where tag is NEW / FIX / UPD / SOON. Mirrors the
// pre-cutover LauncherScreen's tag-pill recipe so existing portal
// patch-notes content renders correctly.
//
// If the patch-note row has a devlog_url, footer surfaces a
// "Read the full devlog post →" link that opens in the player's
// default browser via window.launcher.openExternal. The launcher's
// origin allowlist (main/index.js shell:openExternal handler)
// covers the project-remnant-site domain.

const TAG_KIND = {
  NEW:  'tag-new',
  FIX:  'tag-fix',
  UPD:  'tag-upd',
  SOON: 'tag-soon',
};

export default function PatchNotesModal({ note, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onClickDevlog = (e) => {
    e.preventDefault();
    if (note.devlog_url) window.launcher?.openExternal(note.devlog_url);
  };

  const entries = note?.entries ?? [];
  // Group by tag in a deterministic order so the modal reads top-down.
  // NEW first (additions), then UPD (changes), then FIX (bugfixes), then
  // SOON (preview).
  const order = ['NEW', 'UPD', 'FIX', 'SOON'];
  const grouped = order
    .map((tag) => ({ tag, items: entries.filter((e) => e.tag === tag) }))
    .filter((g) => g.items.length > 0);
  // Catch-all bucket for any tag that's not in the canonical list (e.g.
  // a future tag added before the launcher updates). Renders at bottom.
  const known = new Set(order);
  const orphans = entries.filter((e) => !known.has(e.tag));
  if (orphans.length) grouped.push({ tag: 'OTHER', items: orphans });

  return (
    <div
      className="modal-scrim"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="plate modal-card patch-modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="patch-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <div className="modal-eyebrow">Patch Notes</div>
            <h2 id="patch-modal-title" className="modal-title">
              v{note?.version ?? '?'}
            </h2>
          </div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close patch notes"
          >
            ×
          </button>
        </div>

        <div className="modal-body patch-modal-body">
          {grouped.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-eyebrow">No entries</div>
              <p className="empty-state-body">This release has no published notes.</p>
            </div>
          )}
          {grouped.map(({ tag, items }) => (
            <section key={tag} className="patch-tag-group">
              <h3 className={`patch-tag-heading ${TAG_KIND[tag] ?? ''}`}>{tag}</h3>
              <ul className="patch-tag-list">
                {items.map((entry, i) => (
                  <li key={i} className="patch-tag-item">
                    {entry.text}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="modal-footer patch-modal-footer">
          {note?.devlog_url ? (
            <a
              href={note.devlog_url}
              onClick={onClickDevlog}
              className="patch-devlog-link"
            >
              Read the full devlog post →
            </a>
          ) : (
            <span /> /* spacer keeps Close button right-aligned */
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
