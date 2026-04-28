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
//   #staging-releases  — public-facing release announcement on publish
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
  const footerText = published
    ? "Live to players — auto-updating via electron-updater."
    : "Draft on GitHub. Publish manually to push notes to #staging-releases.";

  const embed = {
    color: LAUNCHER_TEAL,
    title: "🚀 Launcher Release — staging",
    description: `**v${version}** — ${commitCount} commit${commitCount === 1 ? "" : "s"} since last release.`,
    fields: [
      { name: "Release", value: `[v${version} (${stateLabel})](${releaseUrl})` },
    ],
    footer: { text: footerText },
    timestamp: new Date().toISOString(),
  };
  return postEmbed(webhookUrl, embed);
}

/**
 * Post the public patch notes when a launcher release is published
 * to players. Channel: #staging-releases.
 *
 * Title prefix differentiates from game-client posts that share this
 * channel (per plan's channel-rewiring section: #staging-releases is
 * now both products' player-facing announcements).
 *
 * Card link target — TWO links:
 *   - "Download the launcher" → site URL (the actionable CTA — players
 *     who don't have it yet can install fresh; players who do have it
 *     get the auto-update path)
 *   - "Release notes on GitHub" → releaseUrl (for the curious; works
 *     because the launcher-releases repo is public)
 *
 * Bryan-side decision (PR 6 cutover, 2026-04-27): the player-facing
 * card lives in our chrome (the site download URL) so we can swap
 * GitHub for Steam later without breaking player-shared links. The
 * GitHub link stays as a secondary affordance for transparency.
 */
export async function postStagingRelease(
  webhookUrl,
  { version, publicNotes, releaseUrl, downloadUrl },
) {
  const footer = downloadUrl
    ? `\n\n[Download the launcher](${downloadUrl}) · [Release notes on GitHub](${releaseUrl})`
    : `\n\n[Full release →](${releaseUrl})`;
  const max = 4096 - footer.length;
  const description =
    publicNotes.length > max
      ? publicNotes.slice(0, max - 20) + "\n\n_(truncated)_" + footer
      : publicNotes + footer;

  const embed = {
    color: LAUNCHER_TEAL,
    title: `Launcher v${version} published`,
    description,
    footer: { text: "Already-installed launchers self-update automatically on next restart." },
    timestamp: new Date().toISOString(),
  };
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
