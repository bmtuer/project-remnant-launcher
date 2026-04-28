// scripts/release/lib/config.mjs
//
// Reads required env vars from process.env (populated by
// `node --env-file=.env.release`).
//
// Launcher's release flow is meaningfully simpler than the game
// client's — no Railway env-var update, no MIN_REQUIRED_CLIENT_VERSION
// poll. Two webhook URLs + a GitHub PAT and we're done.
//
// #staging-releases is intentionally excluded — that channel is reserved
// for game-client updates to the test server. Launcher releases ship
// silently; the only Discord chatter is the engineering #deploys card
// and the per-release internal #changelog-staging entry.

const REQUIRED = [
  "DISCORD_WEBHOOK_DEPLOYS",
  "DISCORD_WEBHOOK_CHANGELOG",
  "GH_TOKEN", // electron-builder reads this directly during --publish always
];

export function loadConfig() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Missing required env vars in .env.release:\n  - ${missing.join("\n  - ")}\n\n` +
      "Check the file exists at the repo root and contains all required values.\n" +
      "GH_TOKEN must be a classic PAT with 'repo' scope.",
    );
  }

  return {
    discordWebhookDeploys:   process.env.DISCORD_WEBHOOK_DEPLOYS,
    discordWebhookChangelog: process.env.DISCORD_WEBHOOK_CHANGELOG,
    ghToken:                 process.env.GH_TOKEN,
  };
}
