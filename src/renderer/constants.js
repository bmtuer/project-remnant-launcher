// Site URLs the launcher routes to via shell.openExternal. The site's
// account pages plan shipped 2026-04-27 — these destinations are live
// + tested on staging. The closed-beta gate is handled by the site
// itself; the launcher is gate-agnostic.

const SITE_BASE = 'https://project-remnant-site.vercel.app';

export const SITE_URLS = {
  signUp:         `${SITE_BASE}/account/sign-up`,
  forgotPassword: `${SITE_BASE}/account/forgot-password`,
};
