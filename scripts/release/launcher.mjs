#!/usr/bin/env node
// scripts/release/launcher.mjs
//
// Launcher release flow.
//
//   1. Preflight (clean tree, on main, in sync, build passes)
//   2. Prompt for next version (auto-suggests patch bump)
//   3. Generate/resume draft changelog from git log v{prev}..HEAD
//   4. Open in $EDITOR (default: code --wait)
//   5. Validate (sentinel removed + Public + Internal sections)
//   6. Bump package.json, commit, tag, push
//   7. electron-vite build && electron-builder --win --publish always →
//      compiles RemnantLauncher.exe + uploads draft release to
//      bmtuer/project-remnant-launcher-releases
//   8. Poll for the draft, gh release edit to inject public patch notes
//   9. Post to #changelog-staging
//  10. Prompt: publish to players? → on confirm: gh release edit
//      --draft=false + post #staging-releases card
//  11. Always post #deploys card (state reflects publish outcome)
//
// Adapted from project-remnant/scripts/release/client.mjs. Differences:
//   - No Railway env-var update (launcher has no server-side gate)
//   - No /status.minClientVersion poll (no equivalent endpoint)
//   - No portal patch-notes follow-up (launcher IS the launcher)
//   - electron-builder invoked directly (no project-remnant style
//     pnpm release:staging wrapper)
//
// Invoked via: pnpm release:launcher [--version X.Y.Z] [--dry-run]

import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { runPreflight, formatSummary, PreflightError } from "./lib/preflight.mjs";
import { stageFiles, commit, tag, push, pushTag } from "./lib/git.mjs";
import {
  generateDraft, parseEdited, writeDraft, promoteDraftToRelease, draftExists,
  DraftValidationError,
} from "./lib/changelog.mjs";
import { openInEditor } from "./lib/editor.mjs";
import { postChangelog, postLauncherDeployCard } from "./lib/discord.mjs";
import { waitForDraftRelease, editReleaseBody, publishRelease } from "./lib/release.mjs";
import { ask, confirm } from "./lib/prompt.mjs";
import { loadConfig } from "./lib/config.mjs";

const DRY_RUN = process.argv.includes("--dry-run");
const VERSION_ARG = (() => {
  const idx = process.argv.indexOf("--version");
  return idx >= 0 ? process.argv[idx + 1] : null;
})();

const CHANGELOGS_DIR = path.resolve("changelogs");

async function main() {
  console.log("\n🚀 Launcher Release\n");
  if (DRY_RUN) {
    console.log("   DRY RUN — no commits, pushes, compiles, or Discord posts.\n");
  }

  const cfg = loadConfig();

  // ── 1. Preflight ────────────────────────────────────────────
  console.log("Running preflight...");
  let summary;
  try {
    summary = await runPreflight();
  } catch (err) {
    if (err instanceof PreflightError) {
      console.error(`\n✗ Preflight failed:\n${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
  console.log(formatSummary(summary));

  // ── 2. Version ─────────────────────────────────────────────
  const pkgPath = path.resolve("package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const currentVersion = pkg.version;
  const suggested = bumpPatch(currentVersion);

  const newVersion = VERSION_ARG ?? await ask(
    `\nCurrent version: ${currentVersion}\nNext version`, suggested,
  );
  if (!isValidSemver(newVersion)) {
    console.error(`\n✗ Invalid version: "${newVersion}". Must be X.Y.Z.\n`);
    process.exit(1);
  }
  console.log(`\nTarget version: ${newVersion}`);

  // ── 3. Generate or resume draft ─────────────────────────────
  const versionDir = path.join(CHANGELOGS_DIR, `v${newVersion}`);
  let draftPath;

  if (draftExists(CHANGELOGS_DIR, newVersion)) {
    const resume = await confirm(
      `\nExisting draft found at changelogs/v${newVersion}/draft.md. Resume?`,
      true,
    );
    if (resume) {
      draftPath = path.join(versionDir, "draft.md");
      console.log(`  ✓ Resuming existing draft`);
    } else {
      const draft = generateDraft(newVersion);
      draftPath = writeDraft(CHANGELOGS_DIR, newVersion, draft.markdown);
      console.log(`  ✓ Regenerated draft (${draft.commitCount} commits since ${draft.fromTag ?? "initial"})`);
    }
  } else {
    const draft = generateDraft(newVersion);
    draftPath = writeDraft(CHANGELOGS_DIR, newVersion, draft.markdown);
    console.log(`  ✓ Generated draft (${draft.commitCount} commits since ${draft.fromTag ?? "initial"})`);
  }

  // ── 4. Editor ──────────────────────────────────────────────
  console.log(`\nOpening draft in editor (${process.env.EDITOR ?? "code --wait"})...`);
  console.log("  Edit Public + Internal sections, delete the sentinel line, save, then close.");
  console.log("  Close without saving or leave the sentinel in to abort.\n");

  const { modified } = await openInEditor(draftPath);
  if (!modified) {
    console.log("\n✗ Draft was not modified. Release cancelled (draft preserved for resume).\n");
    process.exit(0);
  }

  // ── 5. Validate ────────────────────────────────────────────
  let publicNotes, internalNotes;
  try {
    ({ publicNotes, internalNotes } = parseEdited(draftPath));
  } catch (err) {
    if (err instanceof DraftValidationError) {
      console.error(`\n✗ ${err.message}\n(Draft preserved at ${draftPath} for another edit pass.)\n`);
      process.exit(0);
    }
    throw err;
  }
  console.log(`\n  ✓ Draft validated`);
  console.log(`  ✓ Public section: ${publicNotes.split("\n").filter((l) => l.trim()).length} lines`);
  console.log(`  ✓ Internal section: ${internalNotes.split("\n").filter((l) => l.trim()).length} lines`);

  const confirmRelease = await confirm(`\nProceed with release v${newVersion}?`, false);
  if (!confirmRelease) {
    console.log("\nAborted (draft preserved).\n");
    process.exit(0);
  }

  // ── 6. Promote draft → release.md ──────────────────────────
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would promote draft.md → release.md`);
  } else {
    const releasePath = promoteDraftToRelease(CHANGELOGS_DIR, newVersion);
    console.log(`\n  ✓ Promoted to ${path.relative(process.cwd(), releasePath)}`);
  }

  // ── 7. Bump version ────────────────────────────────────────
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would bump package.json version: ${currentVersion} → ${newVersion}`);
  } else {
    pkg.version = newVersion;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf8");
    console.log(`  ✓ Bumped package.json: ${currentVersion} → ${newVersion}`);
  }

  // ── 8. Commit + tag + push ─────────────────────────────────
  const tagName = `v${newVersion}`;
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would commit "chore: release ${tagName}", tag ${tagName}, push`);
  } else {
    stageFiles([
      "package.json",
      `changelogs/v${newVersion}/release.md`,
    ]);
    commit(`chore: release ${tagName}`, internalNotes);
    console.log(`  ✓ Committed chore: release ${tagName}`);
    tag(tagName);
    console.log(`  ✓ Tagged ${tagName}`);
    push();
    pushTag(tagName);
    console.log(`  ✓ Pushed origin/main and ${tagName}`);
  }

  // ── 9. Build + publish via electron-builder ────────────────
  // electron-builder reads GH_TOKEN from env (loaded by package.json's
  // --env-file=.env.release wrapper) and uploads the .exe + latest.yml +
  // .blockmap files to bmtuer/project-remnant-launcher-releases as a
  // draft release. The block-map files enable differential updates —
  // electron-updater downloads only changed blocks for v0.1.0 → v0.1.1
  // instead of the full binary.
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would run: pnpm exec electron-vite build && pnpm exec electron-builder --win --publish always`);
  } else {
    console.log(`\nBuilding launcher + uploading to GitHub releases...`);
    console.log(`  This will take 1-2 minutes. Output below:\n`);
    try {
      await runSubprocess("pnpm", ["exec", "electron-vite", "build"]);
      await runSubprocess("pnpm", ["exec", "electron-builder", "--win", "--publish", "always"]);
    } catch (err) {
      console.error(`\n✗ Build/publish failed: ${err.message}`);
      console.error(`\nCommit + tag already pushed. To retry, delete the tag and rerun:`);
      console.error(`  git tag -d ${tagName}`);
      console.error(`  git push origin :refs/tags/${tagName}`);
      console.error(`  git reset --hard HEAD~1  # only if you also want to drop the release commit\n`);
      process.exit(1);
    }
    console.log(`\n  ✓ Exe uploaded to project-remnant-launcher-releases (draft)`);
  }

  // ── 10. Wait for draft + edit body ─────────────────────────
  let releaseUrl;
  if (DRY_RUN) {
    releaseUrl = `https://github.com/bmtuer/project-remnant-launcher-releases/releases/tag/${tagName}`;
    console.log(`\n[DRY RUN] Would poll for draft release and edit body with public notes.`);
    console.log(`[DRY RUN] Public notes preview:\n${publicNotes.split("\n").slice(0, 6).join("\n")}\n  ...`);
  } else {
    console.log(`\nPolling for draft release to appear on project-remnant-launcher-releases...`);
    const release = await waitForDraftRelease(tagName, 180_000, (msg) => console.log(`  ${msg}`));
    if (!release) {
      console.error(`\n✗ Draft release ${tagName} did not appear within 3 min. Check the releases repo manually.\n`);
      process.exit(1);
    }
    // Use the tag URL not release.html_url — see project-remnant's
    // client.mjs for the rationale (draft releases have a transient
    // untagged-<sha> URL until publish).
    releaseUrl = `https://github.com/bmtuer/project-remnant-launcher-releases/releases/tag/${tagName}`;

    console.log(`\nUpdating release body with public patch notes...`);
    editReleaseBody(tagName, publicNotes);
    console.log(`  ✓ Release body amended`);
  }

  // ── 11. Discord post — internal changelog ─────────────────
  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would post to #changelog-staging`);
  } else {
    console.log(`\nPosting to Discord...`);
    const changelogOk = await postChangelog(cfg.discordWebhookChangelog, {
      version: newVersion, internalNotes, releaseUrl,
    });
    console.log(changelogOk ? `  ✓ Posted to #changelog-staging` : `  ⚠ #changelog-staging post failed (non-fatal)`);
  }

  // ── 12. Publish prompt + Discord deploy post ───────────────
  // #staging-releases is reserved for game-client updates to the test
  // server. Launcher releases ship silently — no #staging-releases post.
  // The #deploys card still fires (deploy-channel is for engineering
  // visibility across all repos).
  let publishedOk = false;

  if (DRY_RUN) {
    console.log(`\n[DRY RUN] Would prompt to publish draft + post #deploys`);
  } else {
    console.log(``);
    const shouldPublish = await confirm(
      `Publish v${newVersion} to players now? (electron-updater starts auto-updating launchers within minutes.)`,
      true,
    );
    if (shouldPublish) {
      try {
        publishRelease(tagName);
        publishedOk = true;
        console.log(`  ✓ Release published to players`);
      } catch (err) {
        console.error(`\n✗ gh release edit --draft=false failed: ${err.message}`);
        console.error(`\nThe draft is still up on GitHub. You can publish manually at:`);
        console.error(`  ${releaseUrl}`);
        console.error(`(The #deploys card will still be posted with state=draft so the record is honest.)\n`);
      }
    } else {
      console.log(`  ↳ Skipped. Draft remains at ${releaseUrl}`);
      console.log(`    Publish it manually via gh release edit --draft=false or the GitHub UI.`);
    }

    const commitCount = tryCountCommits(`v${currentVersion}`, "HEAD");
    const deploysOk = await postLauncherDeployCard(cfg.discordWebhookDeploys, {
      version: newVersion, commitCount, releaseUrl, published: publishedOk,
    });
    console.log(deploysOk
      ? `  ✓ Posted to #deploys (state: ${publishedOk ? "published" : "draft"})`
      : `  ⚠ #deploys post failed (non-fatal)`);
  }

  // ── 13. Done ────────────────────────────────────────────────
  console.log(`\nDone.\n`);
}

// ── Helpers ─────────────────────────────────────────────────

function bumpPatch(v) {
  const [maj, min, patch] = v.split(".").map(Number);
  return `${maj}.${min}.${patch + 1}`;
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+$/.test(v);
}

function tryCountCommits(fromTag, toRef) {
  try {
    // stdio: "pipe" suppresses git's stderr — first releases (no prior tag)
    // log "fatal: ambiguous argument" otherwise, looking like a real error.
    const out = execSync(`git rev-list --count ${fromTag}..${toRef}`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return Number.parseInt(out.trim(), 10);
  } catch {
    return 0;
  }
}

function runSubprocess(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: true });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

main().catch((err) => {
  console.error(`\n✗ ${err.stack ?? err.message ?? err}\n`);
  process.exit(1);
});
