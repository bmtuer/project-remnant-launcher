# Release v1.0.0

_26 commits since (initial release)_

## Public

<!-- Player-facing patch notes. Short, punchy, 2-5 bullets.
     This becomes the GitHub release body and appears in #staging-releases. -->

- Persistent sign-in 
- Live realm status on the sign-in screen
- Automatic game install, verification, and patching
- Automatic launcher self-update
- Patch notes and announcements
- Settings: auto-launch on boot, close-to-tray, default realm
- System tray with right-click quick actions
- Repair option for the game install

## Internal

<!-- Thorough developer changelog. Grouped by commit type.
     This posts to #changelog-staging on release. -->

### Features
- **pr5** — renderer — realm picker + game version + Play state machine + Repair (2f33d62)
- **pr5** — main-process gameUpdater module — verify, install, repair (33fc4c6)
- **pr4** — Settings overlay body + window-size presets + close-X + auto-launch (9ec45ec)
- **pr4** — launcher subscribes to /launcher Socket.io namespace + REST polling fallback (02581c6)
- **pr4** — launcher reads /status + pre-auth gate on stale launcher version (4efdfe5)
- **pr4** — pnpm release:launcher script + ported lib helpers (8c3e701)
- **pr4** — pin pnpm + wire launcher self-updater (2f06919)
- **pr3** — wire announcements + patch-notes data + PatchNotesModal (3e50963)
- **pr2** — launcher-side game spawn + named-pipe IPC + remnant:// protocol (e0c600e)
- **pr2** — wire launcher hero asset (5f69946)
- **pr2** — two-state shell + Supabase auth + safeStorage tokens (85e6333)
- scaffold launcher repo (PR 1) (9168096)

### Bug fixes
- **pr6** — wire LAUNCHER_DOWNLOAD_URL into #staging-releases card (86fc654)
- **pr5** — dedupe concurrent verify/install calls in main process (c4edb4c)
- **pr5** — rewrite game-binary streaming + log full error to dev console (5963233)
- **pr5** — swap header emojis for inline SVG icons + brand-gold color (baf3d21)
- **pr5** — drop "— online" text from auth status strip; dot carries the status (d0f6123)
- **pr5** — wire AuthScreen status strip to realmStore + load realms on boot (a81a120)
- **pr4** — copy pass on Settings + move launcher version into Settings footer (c1d1d38)
- **pr4** — drop redundant SETTINGS eyebrow above "Launcher Settings" heading (83da78b)
- **pr3** — patch-card content trimmed to version + date only (efe1e56)
- **pr2** — home-screen polish pass — hero spans full main, design-system parity, fixed patch-notes grid (850d807)
- **pr2** — detach hero from announcements scroll — feed scrolls, hero stays put (4bb298b)
- **pr2** — invert home hierarchy — announcements primary, patch notes secondary (1a20ee4)
- **pr2** — allow supabase + game-server origins in renderer CSP (5361cbc)

### Chores
- add launcher icon (placeholder gold R on warm-purple plate) (9f1724b)
