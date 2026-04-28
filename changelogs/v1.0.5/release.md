# Release v1.0.5

_1 commits since v1.0.4_

## Public

NEW
• Realm status dot in the realm picker — green/amber/red at a glance.

UPD
• Full Phase 2 design-system pass: cleaner typography, warmer palette, more atmospheric hero artwork on the home screen.
• AuthScreen now sits on a vignetted painting instead of a flat black field.
• Loading + error + empty states now use real chrome instead of placeholder paragraphs.

FIX
• Launcher window no longer flashes a half-rendered top edge on cold open.

## Internal

Polish sprint closing out the launcher-split work. Functional code unchanged; the sweep brings the launcher up to Phase 2 design-system parity with game/portal/site.

Token foundation:
- --bg-recessed harmonized with game.
- --brand-gold-pressed + --brand-gold-bright tokens replace raw hex in hover recipes.
- --hero-tint-cool / --hero-tint-warm / --hero-bottom-darken keyed to launcher-hero.webp's actual palette (teal sky + rust foliage).

Shared recipes consolidated:
- .form-error (color-mix off --accent-danger) replaces duplicated auth-error + settings-error rgba.
- .skeleton-line (animated gradient on --bg-raised) replaces inline-styled "Loading…" paragraphs across 4 surfaces.
- .empty-state (eyebrow + body) replaces inline-styled empty-state divs.
- patch-tag-heading.tag-new bumped to --accent-success.
- patch-card .kind-deploy class deleted (was a no-op).

AuthScreen: full-bleed launcher-hero.webp behind the auth card, blurred + desaturated + vignetted via ::before/::after layers.

HomeScreen: hero treated as atmosphere not a card — drop card-edge ring + radius, feather all four edges via mask-image. ::after overlay retuned to teal/rust palette. Realm picker gains inline status dot (Battle.net pattern); status word lifted (header-height drift fix).

Main process: BrowserWindow uses show: false + once 'ready-to-show' → show. Fixes the half-rendered top-edge flash.

Release-script Discord card cleanup: drop "— staging" suffix from title, drop obsolete #staging-releases mention from draft footer, remove published footer entirely (timestamp + state label suffice).

Build smoke: green. CSS bundle 60.42 kB after consolidation.