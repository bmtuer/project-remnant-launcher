# Release v1.0.6

_2 commits since v1.0.5_

## Public

<!-- Player-facing patch notes. Short, punchy, 2-5 bullets.
     This becomes the GitHub release body and appears in #staging-releases. -->

- General launcher improvements

## Internal

<!-- Thorough developer changelog. Grouped by commit type.
     This posts to #changelog-staging on release. -->

### Bug fixes
- **updater** — switch manifest parser from latest.yml YAML to manifest.json JSON (7428b7c)
- **release** — use git commit -F over -m to dodge Windows command-line limit (184ecbc)
