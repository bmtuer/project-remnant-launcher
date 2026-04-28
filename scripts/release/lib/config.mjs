// scripts/release/lib/config.mjs
//
// Reads required env vars from process.env (populated by
// `node --env-file=.env.release`).
//
// Launcher's release flow is meaningfully simpler than the game
// client's — no Railway env-var update, no MIN_REQUIRED_CLIENT_VERSION
// poll. Three webhook URLs + a GitHub PAT and we're done.

const REQUIRED = [
  "DISCORD_WEBHOOK_DEPLOYS",
  "DISCORD_WEBHOOK_CHANGELOG",
  "DISCORD_WEBHOOK_STAGING_RELEASES",
  "GH_TOKEN", // electron-builder reads this directly during --publish always
  "LAUNCHER_DOWNLOAD_URL", // public site URL Discord cards link to (PR 6 cutover)
];

export function loadConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars in .env.release:\n  - ${missing.join("\n  - ")}\n\n` +
      "Check the file exists at the repo root and contains all required values.\n" +
      "GH_TOKEN must be a classic PAT with 'repo' scope.\n" +
      "LAUNCHER_DOWNLOAD_URL is the public site URL the Discord cards link to\n" +
      "(typically https://<site>/download/launcher).",
    );
  }

  return {
    discordWebhookDeploys:         process.env.DISCORD_WEBHOOK_DEPLOYS,
    discordWebhookChangelog:       process.env.DISCORD_WEBHOOK_CHANGELOG,
    discordWebhookStagingReleases: process.env.DISCORD_WEBHOOK_STAGING_RELEASES,
    ghToken:                       process.env.GH_TOKEN,
    launcherDownloadUrl:           process.env.LAUNCHER_DOWNLOAD_URL.replace(/\/$/, ""),
  };
}
