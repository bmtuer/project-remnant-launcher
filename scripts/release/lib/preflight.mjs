// scripts/release/lib/preflight.mjs
//
// Shared safety checks run at the top of every release flow.
// - Working tree clean
// - On main (configurable)
// - Not behind origin/main
// - Build passes (launcher has no test suite v1; pnpm build is the
//   structural check — type-checks the renderer + ensures
//   electron-vite can produce a packageable output)
//
// Throws on any failure. Returns a summary object on success.
//
// Adapted from project-remnant/scripts/release/lib/preflight.mjs.
// Difference: build instead of test.

import { execSync } from "node:child_process";
import { isClean, currentBranch, commitsBehindOrigin, headSha, headSubject, dirtyTrackedFiles } from "./git.mjs";

export async function runPreflight({ requireBranch = "main" } = {}) {
  const checks = [];

  // 1. No uncommitted changes on tracked files.
  if (!isClean()) {
    const files = dirtyTrackedFiles();
    const list = files.length > 0
      ? `\n\nTracked files with uncommitted changes:\n  ${files.map((f) => `  - ${f}`).join("\n")}`
      : "";
    const hint = files.length > 0
      ? `\n\nOptions:\n  • Commit the changes:  git add <files> && git commit\n  • Stash them:         git stash\n  • If a file is in .gitignore but still tracked, tell git to ignore\n    local edits to it:  git update-index --skip-worktree <file>`
      : "";
    throw new PreflightError(
      `Working tree has uncommitted changes on tracked files.${list}${hint}`,
    );
  }
  checks.push("No uncommitted changes on tracked files");

  // 2. On expected branch
  const branch = currentBranch();
  if (branch !== requireBranch) {
    throw new PreflightError(
      `On branch '${branch}', expected '${requireBranch}'.\nSwitch branches before releasing.`,
    );
  }
  checks.push(`On branch: ${branch}`);

  // 3. In sync with origin
  const behind = commitsBehindOrigin(requireBranch);
  if (behind > 0) {
    throw new PreflightError(
      `Behind origin/${requireBranch} by ${behind} commit(s). Pull first with \`git pull origin ${requireBranch}\`.`,
    );
  }
  checks.push(`In sync with origin/${requireBranch}`);

  // 4. Build passes (electron-vite). Catches missing imports + bad
  // syntax + broken type-only references. Doesn't run electron-builder
  // (that happens later as part of the actual publish step) — just the
  // bundling step that the publish depends on.
  const buildStart = Date.now();
  try {
    execSync("pnpm build", { stdio: "pipe", encoding: "utf8" });
  } catch (err) {
    const stdout = err.stdout?.toString?.() ?? "";
    const stderr = err.stderr?.toString?.() ?? "";
    const tail = (stdout + stderr).split("\n").slice(-40).join("\n");
    throw new PreflightError(
      `Build failed. Fix before releasing.\n\n--- last 40 lines of output ---\n${tail}`,
    );
  }
  const buildDuration = ((Date.now() - buildStart) / 1000).toFixed(1);
  checks.push(`Build passes (${buildDuration}s)`);

  return {
    branch,
    headSha: headSha(),
    headSubject: headSubject(),
    checks,
  };
}

/** Custom error so callers can distinguish preflight failures from other errors. */
export class PreflightError extends Error {
  constructor(message) {
    super(message);
    this.name = "PreflightError";
  }
}

/** Pretty-print the preflight checks that passed. Caller uses this in CLI output. */
export function formatSummary(summary) {
  return summary.checks.map((c) => `  ✓ ${c}`).join("\n");
}
