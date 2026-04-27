// scripts/release/lib/git.mjs
//
// Thin wrappers around git commands used by the release scripts.
// Every function is synchronous execSync and throws on non-zero exit.

import { execSync } from "node:child_process";

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...opts }).trim();
}

/**
 * Returns true if no tracked file has uncommitted changes.
 * Ignores untracked files and gitignored files — those don't affect what
 * a release would commit/push, so they shouldn't block preflight.
 *
 * Uses the list from `dirtyTrackedFiles()` rather than
 * `git diff-index --quiet`, because on Windows/NTFS diff-index can
 * return exit-1 from stale index timestamps even when the actual file
 * list is empty. A refresh-then-list pattern is more robust.
 */
export function isClean() {
  return dirtyTrackedFiles().length === 0;
}

/**
 * Returns the list of tracked files that have uncommitted changes,
 * for error messaging. Empty array when clean.
 *
 * Calls `git update-index --refresh` first to flush any stale NTFS
 * mtime differences that aren't real content changes. The stderr is
 * suppressed because --refresh loudly prints lines like "needs update"
 * for any dirty file — we only care about the final name-only list.
 */
export function dirtyTrackedFiles() {
  try {
    // Suppress stderr without shell redirects (those don't portable to
    // Windows cmd/PowerShell). execSync with stdio: ignore drops it.
    try {
      execSync("git update-index --refresh", { stdio: "ignore" });
    } catch {
      // refresh exits non-zero if there ARE real dirty files — that's fine,
      // we'll pick them up from diff-index below.
    }
    const out = run("git diff-index --name-only HEAD --");
    return out ? out.split("\n").filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** Returns the current branch name. */
export function currentBranch() {
  return run("git rev-parse --abbrev-ref HEAD");
}

/**
 * Returns the number of commits origin/main is ahead of HEAD.
 * 0 means we're up to date; >0 means we're behind and must pull.
 * Fetches origin first so the comparison is fresh.
 */
export function commitsBehindOrigin(branch = "main") {
  run(`git fetch origin ${branch}`);
  const count = run(`git rev-list --count HEAD..origin/${branch}`);
  return Number.parseInt(count, 10);
}

/** Returns the most recent annotated or lightweight tag matching v* pattern.
 *
 * Uses double quotes around the --match pattern because on Windows, execSync
 * without `shell: true` routes through cmd.exe by default, which doesn't
 * strip single quotes — causing git to see `'v*'` literally and match nothing.
 * Double quotes are stripped by cmd.exe but respected by bash, so this form
 * works on both. */
export function lastReleaseTag() {
  try {
    return run('git describe --tags --abbrev=0 --match "v*"');
  } catch {
    return null;
  }
}

/** Returns one-line summaries of commits between two refs (exclusive..inclusive). */
export function commitsBetween(fromRef, toRef = "HEAD") {
  if (!fromRef) {
    // No prior tag — just return the last 30 commits
    return run(`git log --oneline --no-merges -n 30 ${toRef}`)
      .split("\n")
      .filter(Boolean);
  }
  const out = run(`git log --oneline --no-merges ${fromRef}..${toRef}`);
  return out ? out.split("\n") : [];
}

/** Returns the short SHA of HEAD. */
export function headSha() {
  return run("git rev-parse --short HEAD");
}

/** Returns the commit subject (first line) of HEAD. */
export function headSubject() {
  return run("git log -1 --format=%s");
}

/** Returns the author name of HEAD. */
export function headAuthor() {
  return run("git log -1 --format=%an");
}

/** Returns a short diff --stat summary of staged + unstaged changes against HEAD. */
export function workingTreeStat() {
  return run("git diff --stat HEAD");
}

/** Stages all tracked+untracked files. */
export function stageAll() {
  run("git add -A");
}

/** Stages specific file paths. */
export function stageFiles(paths) {
  if (paths.length === 0) return;
  run(`git add ${paths.map((p) => `"${p}"`).join(" ")}`);
}

/**
 * Creates a commit with a subject and optional multi-line body.
 * Body lines are passed via -m so they become separate paragraphs.
 */
export function commit(subject, body = "") {
  const args = ["git", "commit", "-m", shellQuote(subject)];
  if (body) args.push("-m", shellQuote(body));
  run(args.join(" "));
}

/** Creates a lightweight tag at HEAD. */
export function tag(tagName) {
  run(`git tag ${shellQuote(tagName)}`);
}

/** Deletes a local tag (used only on abort/cleanup). */
export function deleteTag(tagName) {
  try {
    run(`git tag -d ${shellQuote(tagName)}`);
  } catch {
    // fine if it doesn't exist
  }
}

/** Pushes current branch to origin. */
export function push(remote = "origin", branch = "main") {
  run(`git push ${remote} ${branch}`);
}

/** Pushes a specific tag. */
export function pushTag(tagName, remote = "origin") {
  run(`git push ${remote} ${shellQuote(tagName)}`);
}

// Minimal shell escaping for values we control (no user-supplied shell expansion paths).
// Wraps in double quotes and escapes embedded double quotes.
function shellQuote(s) {
  return `"${String(s).replace(/"/g, '\\"')}"`;
}
