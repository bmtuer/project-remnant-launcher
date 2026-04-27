# Remnant Launcher

Standalone Electron launcher for [Project Remnant](https://github.com/bmtuer/project-remnant). Distributed as `RemnantLauncher.exe` — the only binary players ever download. Owns sign-in, realm selection, patch notes, launcher announcements, settings, repair, self-update, and game-binary distribution with differential updates.

Industry-standard launcher-mandatory pattern (WoW / FFXIV / Riot). Companion to the game repo (`project-remnant`), the public site (`project-remnant-site`), and the admin portal (`project-remnant-portal`).

## Architecture

- **Identity acquisition** lives on the public site (`/account/sign-up`, `/account/verify-email`, `/account/forgot-password`, `/account/reset-password`). Launcher footer links open these in the browser via `shell.openExternal`.
- **Sign-in** happens here against the Identity Supabase project (anon key, `signInWithPassword`).
- **Game binary** is fetched via auth-gated launcher-server endpoints that 302-redirect to GitHub-private-asset signed URLs. Game repo never holds the player's machine; players never download from GitHub directly.
- **JWT handoff** to the spawned game process via stdin (single JSON line, then close). Persistent IPC channel via Windows named pipe at `\\.\pipe\remnant-launcher-{launcher-pid}` for runtime token refresh.
- **Self-updates** via `electron-updater` block-map differentials against `bmtuer/project-remnant-launcher-releases` (public).
- **Game updates** via `electron-updater` block-map differentials against `bmtuer/project-remnant-game-releases` (private; server-mediated downloads).

## Scripts

```bash
pnpm dev          # electron-vite dev with HMR
pnpm build        # production build
pnpm build:win    # build + package as Windows installer (no publish)
```

## Repo links

- **Game:** https://github.com/bmtuer/project-remnant
- **Site:** https://github.com/bmtuer/project-remnant-site
- **Portal:** https://github.com/bmtuer/project-remnant-portal
- **Launcher releases:** https://github.com/bmtuer/project-remnant-launcher-releases (public, GitHub Releases for `electron-updater`)
- **Game releases:** https://github.com/bmtuer/project-remnant-game-releases (private, server-mediated downloads only)

## Status

In active development. Tracking plan at [`project-remnant/plans/active/2026-04-26-launcher-split.md`](https://github.com/bmtuer/project-remnant/blob/main/plans/active/2026-04-26-launcher-split.md). System reference at `project-remnant/docs/systems/launcher.md` (lands in PR 6).
