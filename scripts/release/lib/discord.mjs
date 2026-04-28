// scripts/release/lib/discord.mjs
//
// Minimal Discord webhook poster. Posts rich embeds for launcher
// release events.
//
// Color discipline (per the launcher-split plan's channel-rewiring
// section): launcher releases use TEAL 0x4ba89c — semantically "the
// flip from gold," fitting the launcher being a sibling-not-child of
// the game. Server is green, client is gold, portal is blue, site is
// purple, launcher is teal.
//
// Channels (mirror project-remnant's channel map):
//   #deploys           — rich card on every release
//   #changelog-staging — internal patch notes
//
// Launcher releases intentionally do NOT post to #staging-releases
// (that channel is reserved for game-client patch notes — players
// auto-update launchers via electron-updater silently).
//
// Never throws on network failure — logs a warning and continues so
// a transient Discord outage can't block a release after code is
// already pushed.

const REPO_URL = "https://github.com/bmtuer/project-remnant-launcher";
const RELEASES_REPO_URL = "https://github.com/bmtuer/project-remnant-launcher-releases";

const LAUNCHER_TEAL = 0x4ba89c;

/**
 * POST a single embed to a webhook URL.
 * @param {string} webhookUrl
 * @param {object} embed  Discord embed object
 * @param {object} [opts]
 * @param {string} [opts.content]  Optional plain-text content above the embed
 */
async function postEmbed(webhookUrl, embed, opts = {}) {
  if (!webhookUrl) {
    console.warn("[discord] webhook URL not set — skipping post");
    return false;
  }
  try {
    const body = { embeds: [embed] };
    if (opts.content) body.content = opts.content;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[discord] webhook failed: ${res.status} ${text}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`[discord] webhook error: ${err.message}`);
    return false;
  }
}

/**
 * Post the rich "deploy" card for a launcher release.
 * Channel: #deploys (teal — distinguishes from server green / client
 * gold / portal blue / site purple).
 */
export async function postLauncherDeployCard(
  webhookUrl,
  { version, commitCount, releaseUrl, published },
) {
  const stateLabel = published ? "published" : "draft";

  const embed = {
    color: LAUNCHER_TEAL,
    title: "🚀 Launcher Release",
    description: `**v${version}** — ${commitCount} commit${commitCount === 1 ? "" : "s"} since last release.`,
    fields: [
      { name: "Release", value: `[v${version} (${stateLabel})](${releaseUrl})` },
    ],
    timestamp: new Date().toISOString(),
  };
  // Draft state still benefits from a one-line nudge; published state
  // lets the embed timestamp + state label carry the meaning.
  if (!published) {
    embed.footer = {
      text: "Draft on GitHub. Publish manually via gh release edit --draft=false.",
    };
  }
  return postEmbed(webhookUrl, embed);
}

/**
 * Post the internal changelog for a launcher release.
 * Channel: #changelog-staging.
 *
 * Title prefix differentiates from game-client posts.
 */
export async function postChangelog(
  webhookUrl,
  { version, internalNotes, releaseUrl },
) {
  const footer = `\n\n[Full release notes →](${releaseUrl})`;
  const max = 4096 - footer.length;
  const description =
    internalNotes.length > max
      ? internalNotes.slice(0, max - 20) + "\n\n_(truncated)_" + footer
      : internalNotes + footer;

  const embed = {
    color: LAUNCHER_TEAL,
    title: `🚀 Launcher Release — v${version}`,
    description,
    timestamp: new Date().toISOString(),
  };
  return postEmbed(webhookUrl, embed);
}
