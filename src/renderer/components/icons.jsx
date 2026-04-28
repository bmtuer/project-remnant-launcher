// Icon set for the launcher header. Inline SVGs — small enough to
// ship in the bundle, no asset pipeline, no FOUC. All icons are
// 24×24 viewBox with `fill="currentColor"` so they pick up the
// containing button's text color (the header-icon-btn rules drive
// brand-gold via .header-icon-btn-gold below).
//
// Adding icons: keep them 24×24, single-color (use currentColor),
// outline OR solid (be consistent across the set). Aim for visual
// weight matching the existing pair — a Material/Lucide aesthetic.

const ICON_PROPS = {
  width: '1.2em',
  height: '1.2em',
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true,
  focusable: 'false',
};

/** Person silhouette — head + shoulders. The universally-readable
 *  account/profile glyph. */
export function AccountIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8H4z" />
    </svg>
  );
}

/** Cog wheel with 8 teeth + center hole. Standard settings glyph. */
export function SettingsIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.91 2h-3.84a.5.5 0 0 0-.5.42l-.36 2.54a7.07 7.07 0 0 0-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.66 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .61.22l2.39-.96c.5.38 1.04.69 1.62.94l.36 2.54a.5.5 0 0 0 .5.42h3.84a.5.5 0 0 0 .5-.42l.36-2.54a7.07 7.07 0 0 0 1.62-.94l2.39.96a.5.5 0 0 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z" />
    </svg>
  );
}
