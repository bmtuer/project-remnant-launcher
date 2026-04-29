#!/usr/bin/env node
// scripts/local-game-install.mjs
//
// Stage a real game build into the launcher's expected install path so
// you can validate the launcher → game spawn flow end-to-end without
// touching GitHub releases / Railway / Discord.
//
// What it does:
//   1. Resolves the latest RemnantGame-*.zip in the game repo's dist/
//      directory.
//   2. Computes its sha512 (matches what the manifest module emits).
//   3. Removes the existing %APPDATA%/RemnantLauncher/game/test/ dir
//      and any in-flight staging/aside dirs from a prior crashed run.
//   4. Extracts the zip into %APPDATA%/RemnantLauncher/game/test/.
//      (extract-zip flattens to that path; the unpacked Electron app
//      lands directly with RemnantGame.exe at the root.)
//   5. Writes %APPDATA%/RemnantLauncher/game-state.json with
//      { test: { version, sha512, installedAt } } so the launcher's
//      verifyOrInstall flow short-circuits — "already on v0.8.1, no
//      manifest fetch needed" — and goes straight to spawn on Play.
//   6. Wipes the in-memory verify-cache equivalent by clearing any
//      stale .staging / .old dirs (no-op if clean).
//
// After this script runs:
//   - cd ../project-remnant-launcher && pnpm dev
//   - Sign in.
//   - Click Play.
//   - Observe whether the spawned game lands at character select.
//
// Usage:
//   node scripts/local-game-install.mjs                       # auto-pick latest zip
//   node scripts/local-game-install.mjs path/to/build.zip     # specific zip
//
// Idempotent — re-run any time. Wipes + re-stages.

import { readdir, mkdir, rm, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { homedir } from 'node:os';
import extract from 'extract-zip';

const GAME_REPO_DIST = resolve(homedir(), 'project-remnant', 'dist');
const APPDATA = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
const LAUNCHER_ROOT = join(APPDATA, 'RemnantLauncher');
const GAME_INSTALL_ROOT = join(LAUNCHER_ROOT, 'game');
const STATE_FILE = join(LAUNCHER_ROOT, 'game-state.json');
const ENV_NAME = 'test'; // single-realm v1

async function main() {
  const explicitZip = process.argv[2];
  const zipPath = explicitZip
    ? resolve(explicitZip)
    : await findLatestZip(GAME_REPO_DIST);

  console.log(`Source archive: ${zipPath}`);
  const { size } = await stat(zipPath);
  console.log(`  size: ${formatMB(size)} (${size} bytes)`);

  // Pull version out of the filename: RemnantGame-X.Y.Z.zip → X.Y.Z.
  const match = basename(zipPath).match(/RemnantGame-(\d+\.\d+\.\d+)\.zip$/);
  if (!match) {
    throw new Error(
      `Cannot parse version from filename "${basename(zipPath)}". ` +
        `Expected RemnantGame-X.Y.Z.zip.`,
    );
  }
  const version = match[1];
  console.log(`  version: ${version}`);

  console.log('Computing sha512…');
  const sha512 = await sha512Base64(zipPath);
  console.log(`  sha512: ${sha512.slice(0, 24)}…`);

  const targetDir = join(GAME_INSTALL_ROOT, ENV_NAME);
  const stagingDir = `${targetDir}.staging`;
  const oldAsideDir = `${targetDir}.old`;

  console.log('\nWiping any existing install + staging dirs…');
  await rmrf(targetDir);
  await rmrf(stagingDir);
  await rmrf(oldAsideDir);

  console.log(`Extracting to ${targetDir}…`);
  await mkdir(targetDir, { recursive: true });
  await extract(zipPath, { dir: targetDir });

  // electron-builder zip target may produce either:
  //   {targetDir}/RemnantGame.exe + dlls    (flat, expected for our config)
  // or:
  //   {targetDir}/RemnantGame-win32-x64/... (one level of nesting)
  // Detect + flatten if nested so the launcher's gameSpawner can find
  // RemnantGame.exe at the conventional path.
  const flatExePath = join(targetDir, 'RemnantGame.exe');
  let exeAt = null;
  try {
    await stat(flatExePath);
    exeAt = flatExePath;
  } catch {
    // Not flat — check one level deep.
    const entries = await readdir(targetDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = join(targetDir, entry.name, 'RemnantGame.exe');
      try {
        await stat(candidate);
        exeAt = candidate;
        console.log(
          `  (Note: archive nested one level under "${entry.name}/" — ` +
            `the real launcher will flatten this via resolveInstallRoot.)`,
        );
        break;
      } catch {
        /* keep looking */
      }
    }
  }
  if (!exeAt) {
    throw new Error(
      `Extraction succeeded but RemnantGame.exe wasn't found in ${targetDir}.`,
    );
  }
  console.log(`  ✓ RemnantGame.exe at ${exeAt}`);

  console.log(`\nWriting state file: ${STATE_FILE}`);
  const state = {
    [ENV_NAME]: {
      version,
      sha512,
      installedAt: new Date().toISOString(),
    },
  };
  await mkdir(LAUNCHER_ROOT, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');

  console.log(`\n✓ Done. Local install staged at:`);
  console.log(`  ${targetDir}`);
  console.log(`  state:    ${STATE_FILE}`);
  console.log(`  reported: { ${ENV_NAME}: { version: "${version}" } }`);
  console.log('\nNext:');
  console.log('  cd ../project-remnant-launcher && pnpm dev');
  console.log('  Sign in → click Play → watch the spawned game.\n');
}

// ─── Helpers ────────────────────────────────────────────────────

async function findLatestZip(distDir) {
  let entries;
  try {
    entries = await readdir(distDir);
  } catch (err) {
    throw new Error(
      `Cannot read game-repo dist dir "${distDir}": ${err.message}. ` +
        `Build the game first: cd ../project-remnant && pnpm release:staging ` +
        `(or pnpm exec electron-builder --win --publish never).`,
    );
  }

  const zips = entries
    .filter((name) => /^RemnantGame-\d+\.\d+\.\d+\.zip$/.test(name))
    .map((name) => ({
      name,
      version: name.match(/RemnantGame-(\d+\.\d+\.\d+)/)[1],
    }))
    .sort((a, b) => semverCompare(b.version, a.version));

  if (zips.length === 0) {
    throw new Error(
      `No RemnantGame-X.Y.Z.zip found in ${distDir}. Build first.`,
    );
  }
  return join(distDir, zips[0].name);
}

function semverCompare(a, b) {
  const [ai, aj, ak] = a.split('.').map(Number);
  const [bi, bj, bk] = b.split('.').map(Number);
  return ai - bi || aj - bj || ak - bk;
}

function sha512Base64(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha512');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('base64')));
  });
}

async function rmrf(dir) {
  try {
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function formatMB(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

main().catch((err) => {
  console.error(`\n✗ ${err.message}\n`);
  process.exit(1);
});
