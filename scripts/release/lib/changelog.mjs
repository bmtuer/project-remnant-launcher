// scripts/release/lib/changelog.mjs
//
// Draft generation from git log + parser for the edited file.
// The draft starts with a sentinel comment line — if it's still present
// when the user saves, the release is aborted.

import fs from "node:fs";
import path from "node:path";
import { commitsBetween, lastReleaseTag } from "./git.mjs";

export const SENTINEL = "<!-- DELETE THIS LINE TO CONFIRM THE RELEASE. Leaving it in aborts. -->";

// Known Conventional Commit prefixes → human-friendly group labels.
// Unknown prefixes fall into "Other".
const PREFIX_GROUPS = {
  feat:     { public: true,  label: "Features" },
  fix:      { public: true,  label: "Bug fixes" },
  perf:     { public: true,  label: "Performance" },
  refactor: { public: false, label: "Refactoring" },
  chore:    { public: false, label: "Chores" },
  docs:     { public: false, label: "Docs" },
  test:     { public: false, label: "Tests" },
  ci:       { public: false, label: "CI/CD" },
  build:    { public: false, label: "Build" },
  style:    { public: false, label: "Style" },
};

/**
 * Parses `abc123 feat(scope): message` or `abc123 feat: message`
 * into { sha, prefix, scope, message }. Returns null if the line
 * doesn't match conventional commit shape.
 */
function parseCommitLine(line) {
  const match = line.match(/^([a-f0-9]+)\s+(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!match) {
    // Non-conventional commit — treat whole thing as message
    const fallback = line.match(/^([a-f0-9]+)\s+(.+)$/);
    if (!fallback) return null;
    return {
      sha: fallback[1],
      prefix: null,
      scope: null,
      message: fallback[2],
      breaking: false,
    };
  }
  return {
    sha: match[1],
    prefix: match[2].toLowerCase(),
    scope: match[3] ?? null,
    message: match[5],
    breaking: Boolean(match[4]),
  };
}

/**
 * Generates the draft markdown for a new release.
 * Pulls commits since the last v* tag, groups them by prefix, buckets
 * them into Public vs Internal sections.
 *
 * @param {string} newVersion  e.g. "0.6.8"
 * @returns {{ markdown: string, commitCount: number, fromTag: string | null }}
 */
export function generateDraft(newVersion) {
  const fromTag = lastReleaseTag();
  const lines = commitsBetween(fromTag);
  const parsed = lines.map(parseCommitLine).filter(Boolean);

  // Group by prefix
  const grouped = new Map();
  for (const c of parsed) {
    const key = c.prefix ?? "other";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(c);
  }

  // Public bullets — pick feat/fix/perf commits, one line per
  const publicBullets = [];
  for (const [prefix, commits] of grouped) {
    const group = PREFIX_GROUPS[prefix];
    if (!group?.public) continue;
    for (const c of commits) {
      publicBullets.push(`- ${capitalize(c.message)}${c.breaking ? " ⚠️ BREAKING" : ""}`);
    }
  }

  // Internal — full grouping
  const internalSections = [];
  const groupOrder = ["feat", "fix", "perf", "refactor", "chore", "docs", "test", "ci", "build", "style", "other"];
  for (const prefix of groupOrder) {
    const commits = grouped.get(prefix);
    if (!commits || commits.length === 0) continue;
    const label = PREFIX_GROUPS[prefix]?.label ?? "Other";
    const bullets = commits.map((c) => {
      const scope = c.scope ? `**${c.scope}** — ` : "";
      return `- ${scope}${c.message} (${c.sha})`;
    });
    internalSections.push(`### ${label}\n${bullets.join("\n")}`);
  }

  const fromLabel = fromTag ?? "(initial release)";
  const markdown = [
    SENTINEL,
    "",
    `# Release v${newVersion}`,
    "",
    `_${parsed.length} commits since ${fromLabel}_`,
    "",
    "## Public",
    "",
    "<!-- Player-facing patch notes. Short, punchy, 2-5 bullets.",
    "     This becomes the GitHub release body and appears in #staging-releases. -->",
    "",
    publicBullets.length > 0 ? publicBullets.join("\n") : "- _(edit these into player-facing bullets or delete this line)_",
    "",
    "## Internal",
    "",
    "<!-- Thorough developer changelog. Grouped by commit type.",
    "     This posts to #changelog-staging on release. -->",
    "",
    internalSections.join("\n\n"),
    "",
  ].join("\n");

  return { markdown, commitCount: parsed.length, fromTag };
}

/**
 * Reads the edited draft file and validates it.
 * - Sentinel must be removed
 * - Public and Internal sections must be non-empty (after stripping HTML comments)
 *
 * @param {string} filePath
 * @returns {{ publicNotes: string, internalNotes: string }}
 * @throws {DraftValidationError} if the draft is invalid
 */
export function parseEdited(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");

  if (raw.includes(SENTINEL)) {
    throw new DraftValidationError(
      "Sentinel line is still present. Release cancelled.\nDelete the sentinel line to confirm the release, or leave it to abort.",
    );
  }

  const publicNotes = extractSection(raw, "Public");
  const internalNotes = extractSection(raw, "Internal");

  if (!publicNotes) {
    throw new DraftValidationError(
      "Public section is empty or missing. Fill it in before releasing.",
    );
  }
  if (!internalNotes) {
    throw new DraftValidationError(
      "Internal section is empty or missing. Fill it in before releasing.",
    );
  }

  return { publicNotes, internalNotes };
}

/**
 * Extracts the content between `## {name}` and the next `##` heading.
 * Strips HTML comments and trims whitespace.
 */
function extractSection(markdown, name) {
  const re = new RegExp(`##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, "i");
  const match = markdown.match(re);
  if (!match) return "";
  // Strip HTML comments
  const content = match[1].replace(/<!--[\s\S]*?-->/g, "").trim();
  return content;
}

function capitalize(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class DraftValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "DraftValidationError";
  }
}

/**
 * Writes the draft file to disk. Creates the parent dir if needed.
 * Returns the absolute path written.
 */
export function writeDraft(changelogsDir, newVersion, markdown) {
  const versionDir = path.join(changelogsDir, `v${newVersion}`);
  fs.mkdirSync(versionDir, { recursive: true });
  const draftPath = path.join(versionDir, "draft.md");
  fs.writeFileSync(draftPath, markdown, "utf8");
  return draftPath;
}

/** Promotes draft.md → release.md after a successful release. */
export function promoteDraftToRelease(changelogsDir, newVersion) {
  const versionDir = path.join(changelogsDir, `v${newVersion}`);
  const draftPath = path.join(versionDir, "draft.md");
  const releasePath = path.join(versionDir, "release.md");
  fs.renameSync(draftPath, releasePath);
  return releasePath;
}

/** Returns true if a draft already exists for the given version. */
export function draftExists(changelogsDir, newVersion) {
  const draftPath = path.join(changelogsDir, `v${newVersion}`, "draft.md");
  return fs.existsSync(draftPath);
}
