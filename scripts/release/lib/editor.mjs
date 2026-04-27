// scripts/release/lib/editor.mjs
//
// Opens a file in the user's editor and waits for them to close it.
// Returns whether the file was modified (mtime delta) so callers can
// detect "user opened editor but didn't save" as an abort signal.

import { spawn } from "node:child_process";
import fs from "node:fs";

/**
 * Opens filePath in $EDITOR (or a sensible default), blocks until the
 * editor process exits, and returns whether the file was modified.
 *
 * Default editor is `code --wait` since VS Code is the project's
 * standard. Users can override via $EDITOR env var (respected as-is;
 * we trust the user's shell quoting).
 *
 * @param {string} filePath
 * @returns {Promise<{ modified: boolean, mtimeBefore: number, mtimeAfter: number }>}
 */
export async function openInEditor(filePath) {
  const editorCommand = process.env.EDITOR ?? "code --wait";

  const mtimeBefore = fs.statSync(filePath).mtimeMs;

  // Split editor command into argv (naive — supports "code --wait" but
  // not quoted paths with spaces; fine for the common cases).
  const parts = editorCommand.split(/\s+/);
  const cmd = parts[0];
  const args = [...parts.slice(1), filePath];

  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: true, // allow `code`, `nvim`, etc. to resolve via PATH
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0 || code === null) resolve();
      else reject(new Error(`Editor exited with code ${code}`));
    });
  });

  const mtimeAfter = fs.statSync(filePath).mtimeMs;

  return {
    modified: mtimeAfter > mtimeBefore,
    mtimeBefore,
    mtimeAfter,
  };
}
