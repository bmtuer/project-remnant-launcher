// Per-realm game-binary install + verify + update.
//
// Architecture: versioned install paths (Steam-style)
// ────────────────────────────────────────────────────
// Each game version installs to a UNIQUE directory that is never
// reused. The "active" install is just a pointer in the state file
// — switching versions is a state-file write, not a directory swap.
//
// This sidesteps every class of "can't replace the active install
// dir" failure we observed in earlier designs:
//   - Windows EPERM on directory rename when handles are open inside
//   - EBUSY on file rename / copy when AV / cloud-sync / kernel
//     delayed-release pin individual files
//   - ENOENT-disguise from Electron 33's asar-integrity hook (which
//     fires on path-suffix matches of `resources/app.asar` and
//     intercepts open calls disguised as ENOENT)
//
// Because each new install is at a fresh path that has NEVER existed
// before, none of the above can apply: no prior handles exist on the
// path because the path itself is new. Old-version directories may
// have lingering pinned handles, but we never need to MUTATE them
// to install the new version — we just leave them alone and update
// the active pointer.
//
// Industry pattern: Steam does this (steamapps/common/<game>/ is
// active, but updates stage to a sibling dir and switch the manifest
// pointer). Battle.net does this. Cleanup of old version dirs is
// best-effort — if a directory can't be deleted because of a lingering
// OS-level pin, it's harmless disk space, not a functional blocker.
//
// Layout:
//   %APPDATA%/RemnantLauncher/game-versions/
//     test-0.8.2/                    ← OLD version, may be locked
//       RemnantGame.exe
//       resources/app.asar
//     test-0.8.3/                    ← ACTIVE version (per state file)
//       RemnantGame.exe
//       resources/app.asar
//     test-0.8.3.tmp.zip             ← in-flight download (deleted on success)
//
// State file:
//   %APPDATA%/RemnantLauncher/game-state.json
//   {
//     test: {
//       active: "0.8.3",                          ← pointer to current
//       versions: {
//         "0.8.3": {
//           sha512: "...",
//           installedAt: "...",
//           installDir: "<absolute-path>"
//         }
//       }
//     }
//   }

import { app } from 'electron';
import { promises as fs, createWriteStream } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import yauzl from 'yauzl';

const LAUNCHER_DATA_ROOT = join(app.getPath('appData'), 'RemnantLauncher');
const GAME_VERSIONS_ROOT = join(LAUNCHER_DATA_ROOT, 'game-versions');
const GAME_STATE_FILE    = join(LAUNCHER_DATA_ROOT, 'game-state.json');

// Concurrent-call dedupe per env. Two callers (e.g. home-mount effect
// + a Socket.io minClientVersion bump) hitting verifyOrInstall in the
// same window get the same Promise. Without this guard, the second
// caller could race the first's download into the same temp file.
const inFlightByEnv = new Map();

// ─── Path helpers ──────────────────────────────────────────────

function versionInstallDir(env, version) {
  return join(GAME_VERSIONS_ROOT, `${env}-${version}`);
}
function versionTempZip(env, version) {
  return join(GAME_VERSIONS_ROOT, `${env}-${version}.tmp.zip`);
}
function gameBinaryInDir(installDir) {
  return join(installDir, 'RemnantGame.exe');
}

// ─── State file ────────────────────────────────────────────────

async function readGameState() {
  try {
    const raw = await fs.readFile(GAME_STATE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    return {};
  }
}

async function writeGameState(state) {
  await fs.mkdir(dirname(GAME_STATE_FILE), { recursive: true });
  await fs.writeFile(GAME_STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

/** Returns the active version string for env, or null if none installed. */
export async function getInstalledVersion(env) {
  const state = await readGameState();
  return state[env]?.active ?? null;
}

/** Returns the absolute path to the active game binary for env, or
 *  null if not installed / state is malformed. Used by gameSpawner to
 *  resolve the .exe to launch. */
export async function getActiveGameBinaryPath(env) {
  const state = await readGameState();
  const active = state[env]?.active;
  if (!active) return null;
  const meta = state[env]?.versions?.[active];
  if (!meta?.installDir) return null;
  return gameBinaryInDir(meta.installDir);
}

// ─── Manifest fetch ────────────────────────────────────────────
//
// Manifest shape (custom — owned by the game's release script):
//   {
//     "version": "0.8.3",
//     "path":    "RemnantGame-0.8.3.zip",
//     "sha512":  "<base64>",
//     "size":    218000000,
//     "releasedAt": "2026-04-30T..."
//   }
async function fetchManifest({ apiBase, env, jwt }) {
  const url = `${apiBase}/launcher/game-update-info?env=${encodeURIComponent(env)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) {
    throw new Error(`Manifest fetch ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json();
  if (!json?.version || !json?.path || !json?.sha512) {
    throw new Error(`Manifest missing required fields. Got keys: ${Object.keys(json ?? {}).join(', ')}`);
  }
  return {
    version: String(json.version),
    path:    String(json.path),
    sha512:  String(json.sha512),
    size:    json.size != null ? Number(json.size) : null,
  };
}

// ─── Existing-install verify ──────────────────────────────────
//
// "Verify" means: the active version per state matches the manifest,
// AND the binary exists on disk. We don't re-hash the install
// contents — the sha512 in the manifest is for the .zip, not the
// unpacked dir, and re-hashing every file each launch isn't worth
// the cost. Integrity is enforced at download time; corruption after
// install is rare and forceRepair handles it.
async function verifyActive({ env, manifest }) {
  const state = await readGameState();
  if (state[env]?.active !== manifest.version) return false;
  const installDir = state[env]?.versions?.[manifest.version]?.installDir;
  if (!installDir) return false;
  try {
    await fs.access(gameBinaryInDir(installDir));
    return true;
  } catch {
    return false;
  }
}

// ─── Download + install (the actual update path) ──────────────
//
// 1. Stream zip to <env>-<version>.tmp.zip while computing sha512.
// 2. Verify sha512 against manifest.
// 3. Unzip into <env>-<version>/ — a fresh path that has never
//    existed before. No prior locks possible.
// 4. Resolve the install root (electron-builder's zip target may
//    nest the app inside a single inner dir).
// 5. State atomic: set active = new version, add to versions map.
// 6. Cleanup .zip + best-effort old-version dir cleanup.
//
// If anything in steps 1-5 fails, the active install is unchanged —
// we leave the old version still active because we never touched it.
async function downloadAndInstall({ apiBase, env, version, jwt, manifest, onProgress, onPhase }) {
  await fs.mkdir(GAME_VERSIONS_ROOT, { recursive: true });

  const installDir = versionInstallDir(env, version);
  const zipTemp    = versionTempZip(env, version);

  // Defensive cleanup: if a previous attempt for this exact version
  // half-completed, clear its artifacts. Note: this is for re-attempts
  // of the SAME version (rare); we never reuse a path across DIFFERENT
  // versions, so cross-version collisions are impossible.
  await tryRmrf(installDir);
  try { await fs.unlink(zipTemp); } catch { /* ignore — file may not exist */ }

  // ── Stage 1: stream + hash ──
  const url = `${apiBase}/launcher/game-binary?env=${encodeURIComponent(env)}&version=${encodeURIComponent(version)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  if (!res.ok) {
    throw new Error(`Game binary fetch ${res.status}: ${await res.text().catch(() => '')}`);
  }
  if (!res.body) throw new Error('Game binary fetch returned empty body.');

  const total = manifest.size ?? Number(res.headers.get('content-length')) ?? 0;
  let downloaded = 0;
  const hash = createHash('sha512');
  let lastProgressEmit = 0;

  const out = createWriteStream(zipTemp);
  const source = Readable.fromWeb(res.body);
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      hash.update(chunk);
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastProgressEmit >= 100) {
        lastProgressEmit = now;
        const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
        onProgress?.({ percent, downloaded, total });
      }
      cb(null, chunk);
    },
  });

  await pipeline(source, tap, out);
  onProgress?.({ percent: 100, downloaded, total });

  // ── Stage 2: verify sha512 ──
  const computed = hash.digest('base64');
  if (computed !== manifest.sha512) {
    try { await fs.unlink(zipTemp); } catch { /* ignore */ }
    throw new Error(
      `sha512 mismatch — download corrupted (got ${computed.slice(0, 16)}…, expected ${manifest.sha512.slice(0, 16)}…)`,
    );
  }

  // ── Stage 3: unzip into the fresh per-version dir ──
  onPhase?.('installing');
  await fs.mkdir(installDir, { recursive: true });
  try {
    await unzipBufferedWrites(zipTemp, installDir);
  } catch (err) {
    await tryRmrf(installDir);
    try { await fs.unlink(zipTemp); } catch { /* ignore */ }
    throw new Error(`Unzip failed: ${err.message}`);
  }

  // electron-builder's zip target sometimes nests the app inside a
  // single inner dir (e.g. RemnantGame-win32-x64/). Resolve which
  // dir actually contains RemnantGame.exe; if it's an inner dir,
  // promote that dir's contents to the outer.
  const finalInstallDir = await resolveAndPromoteInstallRoot(installDir);
  if (!finalInstallDir) {
    await tryRmrf(installDir);
    try { await fs.unlink(zipTemp); } catch { /* ignore */ }
    throw new Error('Unzipped archive did not contain RemnantGame.exe');
  }

  // ── Stage 4: state atomic — set this version active ──
  const state = await readGameState();
  const previousActive = state[env]?.active ?? null;
  state[env] = state[env] ?? {};
  state[env].versions = state[env].versions ?? {};
  state[env].versions[version] = {
    sha512:      manifest.sha512,
    installedAt: new Date().toISOString(),
    installDir:  finalInstallDir,
  };
  state[env].active = version;
  await writeGameState(state);

  // ── Stage 5: cleanup ──
  // .zip is no longer needed; old version dirs become eligible for
  // best-effort delete. Failures here are silent and harmless.
  try { await fs.unlink(zipTemp); } catch { /* ignore */ }
  if (previousActive && previousActive !== version) {
    cleanupOldVersionInBackground(env, previousActive);
  }
}

// ─── Background cleanup of old version dirs ───────────────────
//
// Runs detached from the install flow. If a previous version's dir
// is still locked by Defender / cloud-sync / whatever, the cleanup
// fails silently — it's harmless disk space until the next launcher
// session retries. We also remove the old version's entry from the
// state.versions map so we don't claim it's installed when its files
// might already be partially gone.
function cleanupOldVersionInBackground(env, oldVersion) {
  // Don't await — fire and forget. Errors logged, never thrown.
  (async () => {
    const oldDir = versionInstallDir(env, oldVersion);
    try {
      await fs.rm(oldDir, { recursive: true, force: true });
      // Successful delete: also remove from state.
      const state = await readGameState();
      if (state[env]?.versions?.[oldVersion]) {
        delete state[env].versions[oldVersion];
        await writeGameState(state);
      }
    } catch (err) {
      // Pinned by OS — leave on disk, leave in state. Will retry next
      // session via cleanupOrphans.
      console.warn(`[gameUpdater] could not delete old version ${oldVersion}: ${err.message}`);
    }
  })();
}

// ─── Legacy cleanup ─────────────────────────────────────────────
//
// Pre-versioned-install launchers used:
//   %APPDATA%/RemnantLauncher/game/{env}/   (active install)
//   %APPDATA%/RemnantLauncher/game/{env}.staging/  (staging dir)
//   %APPDATA%/RemnantLauncher/game/{env}.old/  (rename-aside dir)
// And state file entries with shape { version, sha512, installedAt }.
//
// New launchers use game-versions/ entirely. Legacy installs are
// ignored at runtime (state's `active` pointer will be undefined,
// triggering a fresh download to the new path scheme on first launch).
// This function best-effort-deletes the old dirs to reclaim disk space.
// Failures are logged + skipped — same pattern as version cleanup.
async function cleanupLegacyInstalls() {
  const legacyRoot = join(LAUNCHER_DATA_ROOT, 'game');
  let entries;
  try {
    entries = await fs.readdir(legacyRoot, { withFileTypes: true });
  } catch {
    return; // Legacy root doesn't exist — clean.
  }
  for (const entry of entries) {
    const path = join(legacyRoot, entry.name);
    try {
      if (entry.isDirectory()) {
        await fs.rm(path, { recursive: true, force: true });
      } else {
        await fs.unlink(path);
      }
    } catch (err) {
      console.warn(`[gameUpdater] legacy cleanup skipped ${entry.name}: ${err.code ?? err.message}`);
    }
  }
  // Try to remove the now-empty parent. Failure means something is
  // still pinned inside; harmless.
  try { await fs.rmdir(legacyRoot); } catch { /* ignore */ }

  // Migrate state: drop legacy fields if they exist on any env.
  const state = await readGameState();
  let mutated = false;
  for (const env of Object.keys(state)) {
    if (state[env]?.version !== undefined && state[env]?.active === undefined) {
      // Legacy shape detected. Drop the legacy fields entirely; the
      // next verifyOrInstall will trigger a fresh download under the
      // new versioned-install scheme.
      delete state[env].version;
      delete state[env].sha512;
      delete state[env].installedAt;
      mutated = true;
    }
  }
  if (mutated) await writeGameState(state);
}

// ─── Orphan cleanup at boot ───────────────────────────────────
//
// Called from src/main/index.js on app.whenReady. Scans the
// game-versions/ directory + state file for:
//   - Version dirs not referenced by any state.<env>.versions entry
//     (orphans from a crashed install)
//   - State.versions entries whose installDir is missing from disk
//     (stale state)
//   - Inactive version dirs we previously failed to clean up
//     (every boot we get another shot at deleting them)
//   - .tmp.zip files leftover from interrupted downloads
//   - Legacy game/ dir from pre-versioned-install launchers
//
// All operations are best-effort. A stuck path stays as ~200MB of
// disk; the active install is never affected.
export async function cleanupOrphans() {
  // One-time legacy cleanup — does nothing on launchers that have
  // already migrated.
  await cleanupLegacyInstalls();

  let entries;
  try {
    entries = await fs.readdir(GAME_VERSIONS_ROOT, { withFileTypes: true });
  } catch {
    return; // Dir doesn't exist yet (fresh launcher) — nothing to clean.
  }

  const state = await readGameState();
  // Gather all (env, version, installDir) triples we DO want to keep:
  // the active version for each env, plus any versions still in the
  // state.versions map (e.g. previous version we haven't cleaned yet).
  const keep = new Set();
  for (const env of Object.keys(state)) {
    for (const ver of Object.keys(state[env]?.versions ?? {})) {
      const dir = state[env].versions[ver]?.installDir;
      if (dir) keep.add(dir);
    }
  }

  for (const entry of entries) {
    const fullPath = join(GAME_VERSIONS_ROOT, entry.name);

    // Sweep .tmp.zip files unconditionally (they're never used after
    // a successful install).
    if (entry.isFile() && entry.name.endsWith('.tmp.zip')) {
      try { await fs.unlink(fullPath); } catch { /* ignore */ }
      continue;
    }

    // Sweep version dirs not referenced by state. Best-effort.
    if (entry.isDirectory() && !keep.has(fullPath)) {
      try {
        await fs.rm(fullPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[gameUpdater] orphan cleanup skipped ${entry.name}: ${err.code ?? err.message}`);
      }
    }
  }

  // Drop state.versions entries whose installDir vanished from disk
  // (e.g. user manually deleted the dir).
  let stateMutated = false;
  for (const env of Object.keys(state)) {
    const versions = state[env]?.versions ?? {};
    for (const ver of Object.keys(versions)) {
      const dir = versions[ver]?.installDir;
      let exists = false;
      try { await fs.access(dir); exists = true; } catch { /* missing */ }
      if (!exists) {
        delete state[env].versions[ver];
        stateMutated = true;
        // If the missing dir was the active version, clear active
        // pointer so the next verify treats it as not-installed.
        if (state[env].active === ver) {
          state[env].active = null;
          stateMutated = true;
        }
      }
    }
    // Also: try to delete inactive version dirs we previously failed
    // to clean. Active dir stays.
    const active = state[env]?.active;
    for (const ver of Object.keys(state[env]?.versions ?? {})) {
      if (ver === active) continue;
      const dir = state[env].versions[ver]?.installDir;
      if (!dir) continue;
      try {
        await fs.rm(dir, { recursive: true, force: true });
        delete state[env].versions[ver];
        stateMutated = true;
      } catch {
        // Still pinned. Leave it; we'll try again next boot.
      }
    }
  }
  if (stateMutated) await writeGameState(state);
}

// Best-effort rmrf — never throws. Used in install-flow cleanup paths
// where a missing/locked dir is recoverable (we just log + skip).
async function tryRmrf(path) {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// ─── Unzip with asar-integrity-hook bypass ────────────────────
//
// CRITICAL: uses fs.writeFile(buffer) per entry, NOT createWriteStream.
// Reason: Electron 33's asar-integrity hook fires on fs.open of any
// path matching `resources/app.asar` (suffix match), even when the
// integrity fuse is disabled. The runtime open-hook stays armed
// against the build-time integrity stamp on the launcher binary.
// fs.writeFile takes a different code path that buffers the data +
// writes once, bypassing the hook.
//
// For our 200 MB game zip this peaks memory at ~50 MB (the largest
// single entry — the inner game's app.asar). Acceptable for desktop.
function unzipBufferedWrites(archivePath, destDir) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      let pending = 0;
      let cancelled = false;
      let closed = false;

      const finish = () => {
        if (cancelled) return;
        if (!closed || pending > 0) return;
        resolve();
      };

      const fail = (err) => {
        if (cancelled) return;
        cancelled = true;
        try { zipfile.close(); } catch { /* ignore */ }
        reject(err);
      };

      zipfile.on('error', fail);
      zipfile.on('close', () => { closed = true; finish(); });

      zipfile.on('entry', async (entry) => {
        if (cancelled) return;

        if (/\/$/.test(entry.fileName)) {
          try {
            await fs.mkdir(join(destDir, entry.fileName), { recursive: true });
          } catch (e) { return fail(e); }
          zipfile.readEntry();
          return;
        }

        const target = join(destDir, entry.fileName);
        const canonicalDestDir = await fs.realpath(destDir).catch(() => destDir);
        if (!target.startsWith(canonicalDestDir)) {
          return fail(new Error(`Out of bound path "${target}"`));
        }

        pending++;
        zipfile.openReadStream(entry, async (err, readStream) => {
          if (err) { pending--; return fail(err); }
          const chunks = [];
          readStream.on('data', (c) => chunks.push(c));
          readStream.on('error', (e) => { pending--; fail(e); });
          readStream.on('end', async () => {
            try {
              await fs.mkdir(dirname(target), { recursive: true });
              await fs.writeFile(target, Buffer.concat(chunks));
            } catch (e) {
              pending--;
              return fail(e);
            }
            pending--;
            zipfile.readEntry();
            finish();
          });
        });
      });

      zipfile.readEntry();
    });
  });
}

// electron-builder's zip target may put RemnantGame.exe at the root
// of the archive OR inside a single inner dir. If at root: return
// installDir as-is. If inside an inner dir: move the inner contents
// up to installDir so the spawner finds RemnantGame.exe at the
// expected path. Returns the final install dir on success, null if
// RemnantGame.exe couldn't be located.
async function resolveAndPromoteInstallRoot(installDir) {
  // Direct hit?
  try {
    await fs.access(gameBinaryInDir(installDir));
    return installDir;
  } catch { /* fall through */ }

  // One level deep?
  const entries = await fs.readdir(installDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const inner = join(installDir, entry.name);
    try {
      await fs.access(gameBinaryInDir(inner));
      // Promote inner's contents up to installDir.
      // Strategy: read inner's children, rename each to its sibling
      // position in installDir. This avoids having to rename
      // installDir itself (which might trip the same dir-rename
      // EPERM we sidestepped earlier).
      const innerEntries = await fs.readdir(inner, { withFileTypes: true });
      for (const inEntry of innerEntries) {
        await fs.rename(
          join(inner, inEntry.name),
          join(installDir, inEntry.name),
        );
      }
      // Remove the now-empty inner dir.
      try { await fs.rmdir(inner); } catch { /* ignore */ }
      return installDir;
    } catch {
      // try next
    }
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Verify or install the game for env. If the active install matches
 * the manifest version + binary exists → done. Otherwise → download
 * + install + activate the new version.
 *
 * Returns { version, didInstall }.
 *
 * Status events:
 *   { phase: 'manifest' }
 *   { phase: 'verifying' }
 *   { phase: 'downloading', version, percent, downloaded, total }
 *   { phase: 'installing', version }
 *   { phase: 'done', version }
 */
export async function verifyOrInstall({ apiBase, env, jwt, onStatus }) {
  const existing = inFlightByEnv.get(env);
  if (existing) return existing;

  const promise = runVerifyOrInstall({ apiBase, env, jwt, onStatus })
    .finally(() => inFlightByEnv.delete(env));
  inFlightByEnv.set(env, promise);
  return promise;
}

async function runVerifyOrInstall({ apiBase, env, jwt, onStatus }) {
  onStatus?.({ phase: 'manifest' });
  const manifest = await fetchManifest({ apiBase, env, jwt });

  onStatus?.({ phase: 'verifying' });
  if (await verifyActive({ env, manifest })) {
    onStatus?.({ phase: 'done', version: manifest.version });
    return { version: manifest.version, didInstall: false };
  }

  onStatus?.({ phase: 'downloading', version: manifest.version, percent: 0 });
  await downloadAndInstall({
    apiBase,
    env,
    version: manifest.version,
    jwt,
    manifest,
    onProgress: ({ percent, downloaded, total }) => {
      onStatus?.({ phase: 'downloading', version: manifest.version, percent, downloaded, total });
    },
    onPhase: (phase) => {
      onStatus?.({ phase, version: manifest.version });
    },
  });

  onStatus?.({ phase: 'done', version: manifest.version });
  return { version: manifest.version, didInstall: true };
}

/**
 * Force a full reinstall regardless of state. Used by Settings →
 * Repair. Clears the active pointer so the verify path falls through
 * to download. The old install dir gets best-effort cleanup after
 * the new one is active.
 */
export async function forceRepair({ apiBase, env, jwt, onStatus }) {
  const existing = inFlightByEnv.get(env);
  if (existing) return existing;

  // Clear active pointer so verify always falls through to download.
  // Don't touch the versions map or installDirs — cleanupOldVersionInBackground
  // handles those after the new install activates.
  const state = await readGameState();
  if (state[env]) {
    state[env].active = null;
    await writeGameState(state);
  }

  return verifyOrInstall({ apiBase, env, jwt, onStatus });
}
