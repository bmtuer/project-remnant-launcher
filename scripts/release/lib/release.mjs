// scripts/release/lib/release.mjs
//
// GitHub release helpers via the `gh` CLI. We don't create releases —
// electron-builder does that via `--publish always` during the exe
// compile. We only *edit* the draft body to inject public patch notes,
// and we poll for the draft to appear (since the compile step runs
// asynchronously and electron-builder uploads can lag a few seconds).

import { execSync } from "node:child_process";
import fs from "node:fs";

// Launcher releases live in their own public repo (separate from the
// game's project-remnant-releases). Contains only launcher binaries
// + electron-updater manifests.
const RELEASES_REPO = "bmtuer/project-remnant-launcher-releases";

/**
 * Poll GitHub for the draft release matching the given tag.
 * Returns the release's html_url and id, or null on timeout.
 *
 * @param {string} tagName  e.g. "v0.6.8"
 * @param {number} [timeoutMs]  default 180_000
 * @param {(msg: string) => void} [onTick]
 */
export async function waitForDraftRelease(tagName, timeoutMs = 180_000, onTick = () => {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const elapsed = Date.now() - start;
    try {
      // Fetch the full releases array and filter in Node. Avoids shell-quoting
      // issues with `--jq` on Windows PowerShell (single quotes don't delimit
      // string args there the way bash does, so `--jq '...'` gets mangled).
      const out = execSync(
        `gh api repos/${RELEASES_REPO}/releases`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      ).trim();
      const releases = JSON.parse(out);
      const match = releases.find((r) => r.tag_name === tagName);
      if (match) {
        const release = { id: match.id, html_url: match.html_url, draft: match.draft };
        onTick(`[${formatElapsed(elapsed)}] Draft release found: ${release.html_url}`);
        return release;
      }
      onTick(`[${formatElapsed(elapsed)}] Waiting for electron-builder to upload release...`);
    } catch (err) {
      onTick(`[${formatElapsed(elapsed)}] gh api error (retrying): ${err.message.split("\n")[0]}`);
    }
    await sleep(5_000);
  }
  return null;
}

/**
 * Edit the draft release body to contain the public patch notes.
 * `gh release edit` expects notes on stdin or via --notes-file.
 *
 * @param {string} tagName       e.g. "v0.6.8"
 * @param {string} publicNotes   markdown body
 */
export function editReleaseBody(tagName, publicNotes) {
  // Write notes to a temp file — notes with special chars would break --notes ""
  const tmpPath = `${process.cwd()}/.release-notes.tmp.md`;
  fs.writeFileSync(tmpPath, publicNotes, "utf8");
  try {
    execSync(
      `gh release edit ${tagName} --repo ${RELEASES_REPO} --notes-file "${tmpPath}"`,
      { stdio: "pipe", encoding: "utf8" },
    );
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

/**
 * Transition a draft release to published. Makes the .exe downloadable by
 * electron-updater on players' launchers.
 *
 * @param {string} tagName  e.g. "v0.6.8"
 */
export function publishRelease(tagName) {
  execSync(
    `gh release edit ${tagName} --repo ${RELEASES_REPO} --draft=false`,
    { stdio: "pipe", encoding: "utf8" },
  );
}

function formatElapsed(ms) {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
