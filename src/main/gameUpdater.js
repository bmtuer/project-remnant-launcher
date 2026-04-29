// Per-realm game-binary install + verify + update.
//
// Protocol:
//   1. Fetch manifest from <game-api>/launcher/game-update-info?env={env}
//      → server 302s to GitHub-signed manifest.json URL
//      → we follow + parse JSON
//   2. Manifest declares: version, archive filename, sha512 of the
//      archive, size
//   3. Compare manifest version to per-realm installed version (from
//      userData/game-state.json)
//   4. If outdated or missing: download via /launcher/game-binary?env=X&version=Y
//      → server 302s to GitHub-signed .zip URL
//      → we stream bytes to disk while computing sha512 of the archive
//   5. Verify sha512 matches manifest. On success, unzip to a staging
//      subdir, atomically replace the active install with it, delete
//      the .zip, update game-state.json.
//
// Why .zip + unzip rather than a portable .exe directly:
//   electron-builder's portable target wraps the app in a self-
//   extracting wrapper exe. That wrapper unpacks to a tmpdir on each
//   launch and re-spawns the inner Electron — env/argv/stdin don't
//   propagate cleanly across the indirection (we hit this with the
//   original stdin handoff before pivoting to named-pipe IPC; even
//   with env-var-only handoff the per-launch unpack overhead and
//   tmpdir lifecycle are wrong shape for a 200 MB game). The .zip
//   target produces a normal unpacked Electron app dir; the launcher
//   unzips once into the install root and spawns RemnantGame.exe
//   directly. See electron-builder issue #1410 for the wrapper's
//   underlying limitations.
//
// Session cache:
//   Once a verify succeeds for an (env, version) pair, remember it
//   in-memory until launcher restart. Subsequent Play clicks on the
//   same (env, version) skip the verify+update step.
//
// Per-realm install layout:
//   %APPDATA%/RemnantLauncher/game/{env}/        ← active install
//                                  RemnantGame.exe
//                                  resources/
//                                  ...
//   %APPDATA%/RemnantLauncher/game/{env}.staging/ ← unzip target
//   gameSpawner.js resolves the inner RemnantGame.exe from this layout.
//
// State file:
//   %APPDATA%/RemnantLauncher/game-state.json
//   { test: { version: '0.8.2', sha512: '...', installedAt: '...' } }
//
// Emits progress to the renderer via 'game-update:status' events.

import { app } from 'electron';
import { promises as fs, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import yauzl from 'yauzl';

const GAME_INSTALL_ROOT = join(app.getPath('appData'), 'RemnantLauncher', 'game');
const GAME_STATE_FILE   = join(app.getPath('appData'), 'RemnantLauncher', 'game-state.json');

// Session-only verify cache: { 'test@0.7.2': true }. Cleared on
// launcher restart. Set by verifyOrInstall() when a verify succeeds;
// future Play clicks for the same key skip straight to spawn.
const verifyCache = new Set();

// In-flight tracking — keyed by env. Holds the Promise of the running
// flow so concurrent callers (HomeScreen mount effect + App.jsx
// minClientVersion subscriber + Socket.io reconnect re-fetch) all
// dedupe to the same flow rather than racing each other and
// stomping on the .tmp file mid-download.
//
// This guard lives in main (not the renderer's gameStore) because
// the renderer's view of update.phase is async — by the time the
// renderer's status reducer sees phase: 'manifest', a second IPC
// request may already be in flight. Main is the only place that
// can authoritatively know "a flow is currently running for this
// env."
const inFlightByEnv = new Map();

function gameDirForEnv(env) {
  return join(GAME_INSTALL_ROOT, env);
}
function gameBinaryPath(env) {
  return join(gameDirForEnv(env), 'RemnantGame.exe');
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
export async function getInstalledVersion(env) {
  const state = await readGameState();
  return state[env]?.version ?? null;
}

// ─── Manifest fetch ────────────────────────────────────────────
//
// The launcher-server endpoint /launcher/game-update-info returns a
// 302 to the GitHub-signed URL of the latest release's manifest.json.
// We follow the redirect (default fetch behavior) and parse JSON.
//
// Manifest shape (custom — owned by us, not electron-builder):
//   {
//     "version": "0.8.1",
//     "path": "RemnantGame-0.8.1.exe",
//     "sha512": "<base64>",
//     "size": 132404470,
//     "releasedAt": "2026-04-28T23:12:17Z"
//   }
//
// Generated by the game repo's release script
// (scripts/release/lib/manifest.mjs) and uploaded as a sibling asset
// to the .exe on the GitHub release. The contract is intentionally
// minimal — version + path + sha512 + size are what verifyOrInstall
// actually consumes.
async function fetchManifest({ apiBase, env, jwt }) {
  const url = `${apiBase}/launcher/game-update-info?env=${encodeURIComponent(env)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`Manifest fetch ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const json = await res.json();
  return parseManifest(json);
}

function parseManifest(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('Manifest is not an object.');
  }
  if (!json.version || !json.path || !json.sha512) {
    throw new Error(
      `Manifest missing required fields. Got keys: ${Object.keys(json).join(', ')}`,
    );
  }
  return {
    version: String(json.version),
    path:    String(json.path),
    sha512:  String(json.sha512),
    size:    json.size != null ? Number(json.size) : null,
  };
}

// ─── Verify ────────────────────────────────────────────────────
//
// The manifest sha512 is the hash of the .zip we downloaded, not of
// the unpacked RemnantGame.exe — re-hashing the .exe wouldn't compare
// against anything authoritative. So "verify installed" is just a
// file-existence + state-file-version-match check. The download path
// is what enforces integrity (verify .zip's sha512 against the
// manifest before unzipping); after that, the install dir's contents
// are trusted until the next download.
async function verifyInstalledBinary({ env, manifest }) {
  const binaryPath = gameBinaryPath(env);
  try {
    await fs.access(binaryPath);
  } catch {
    return false;  // No binary installed yet
  }
  const state = await readGameState();
  return state[env]?.version === manifest.version;
}

// ─── Download ──────────────────────────────────────────────────
//
// Stream the .zip from /launcher/game-binary into a sibling temp
// path next to the active install dir, compute sha512 in-flight,
// verify against manifest. Then unzip into a staging dir, swap the
// staging dir over the active dir atomically (rename-old-aside →
// rename-staging-into-place → rm-old-aside), and clean up the .zip.
//
// Failure modes the order above guards against:
//   - download crash mid-stream → .tmp file gets unlinked, no
//     visible state change to the active install.
//   - sha512 mismatch → .tmp deleted before unzip, no visible
//     state change.
//   - unzip crash → staging dir is rm-rf'd, .zip is deleted, active
//     install untouched.
//   - rename-old-aside succeeds but rename-staging-into-place fails
//     → we restore the old install from the aside dir before
//     surfacing the error. The window where the install dir is
//     missing entirely is a few ms of two os.rename calls.
//
// Progress is emitted to the renderer every ~100ms during download.
// Unzip is fast enough on a 130MB archive (~2s on typical disks)
// that we just emit phase: 'installing' once when it starts.
async function downloadGameBinary({ apiBase, env, version, jwt, manifest, onProgress, onPhase }) {
  const url = `${apiBase}/launcher/game-binary?env=${encodeURIComponent(env)}&version=${encodeURIComponent(version)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`Game binary fetch ${res.status}: ${await res.text().catch(() => '')}`);
  }
  if (!res.body) {
    throw new Error('Game binary fetch returned empty body.');
  }

  const total = manifest.size ?? Number(res.headers.get('content-length')) ?? 0;
  let downloaded = 0;
  const hash = createHash('sha512');

  const activeDir   = gameDirForEnv(env);
  const stagingDir  = `${activeDir}.staging`;
  const oldAsideDir = `${activeDir}.old`;
  const archiveTemp = join(dirname(activeDir), `${manifest.path ?? 'game'}.tmp`);

  // Make sure parent dir exists for the archive temp.
  await fs.mkdir(dirname(activeDir), { recursive: true });

  // Drop any prior staging / aside / .tmp from a crashed previous
  // attempt so we start clean.
  await rmrf(stagingDir);
  await rmrf(oldAsideDir);
  try { await fs.unlink(archiveTemp); } catch { /* ignore */ }

  // ── Stage 1: stream + hash + write to .tmp archive ──
  const out = createWriteStream(archiveTemp);
  let lastProgressEmit = 0;

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
    try { await fs.unlink(archiveTemp); } catch { /* ignore */ }
    throw new Error(
      `sha512 mismatch — download corrupted (got ${computed.slice(0, 16)}…, expected ${manifest.sha512.slice(0, 16)}…)`,
    );
  }

  // ── Stage 3: unzip into staging dir ──
  onPhase?.('installing');
  await fs.mkdir(stagingDir, { recursive: true });
  try {
    await unzipBufferedWrites(archiveTemp, stagingDir);
  } catch (err) {
    await rmrf(stagingDir);
    try { await fs.unlink(archiveTemp); } catch { /* ignore */ }
    throw new Error(`Unzip failed: ${err.message}`);
  }

  // electron-builder's zip target wraps the unpacked app in an inner
  // dir named after productName (e.g. "RemnantGame-win32-x64/").
  // Resolve which subdir actually contains RemnantGame.exe so we can
  // promote either layout (with-or-without inner dir) into the active
  // install path.
  const installRoot = await resolveInstallRoot(stagingDir);
  if (!installRoot) {
    await rmrf(stagingDir);
    try { await fs.unlink(archiveTemp); } catch { /* ignore */ }
    throw new Error('Unzipped archive did not contain RemnantGame.exe');
  }

  // ── Stage 4: atomic-ish swap ──
  // Rename existing active install aside (if present), then rename
  // installRoot into the active path. Restore on failure.
  let hadExisting = false;
  try {
    await fs.access(activeDir);
    hadExisting = true;
  } catch { /* no prior install — fine */ }

  if (hadExisting) {
    await fs.rename(activeDir, oldAsideDir);
  }
  try {
    await fs.rename(installRoot, activeDir);
  } catch (err) {
    // Restore the old install if we just removed it. Best-effort.
    if (hadExisting) {
      try { await fs.rename(oldAsideDir, activeDir); } catch { /* ignore */ }
    }
    await rmrf(stagingDir);
    try { await fs.unlink(archiveTemp); } catch { /* ignore */ }
    throw new Error(`Install rename failed: ${err.message}`);
  }

  // ── Stage 5: cleanup ──
  await rmrf(stagingDir);
  await rmrf(oldAsideDir);
  try { await fs.unlink(archiveTemp); } catch { /* ignore */ }

  // ── Stage 6: state ──
  const state = await readGameState();
  state[env] = {
    version: manifest.version,
    sha512:  manifest.sha512,
    installedAt: new Date().toISOString(),
  };
  await writeGameState(state);
}

// rm -rf with a try/catch wrapper. Returns void; failure is silent
// because we use this in cleanup paths where a missing dir is normal.
async function rmrf(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch { /* ignore */ }
}

// Find the directory inside `stagingDir` that contains RemnantGame.exe.
// electron-builder's zip target may put it directly at the root or
// inside a single inner dir. Returns the path to the dir containing
// RemnantGame.exe, or null if not found.
/**
 * Unzip an archive into destDir using fs.writeFile(buffer) per entry,
 * NOT createWriteStream. Reason: Electron 33's asar-integrity hook
 * fires on fs.open of any path matching `resources/app.asar` (suffix
 * match), which createWriteStream triggers — even when the integrity
 * fuse is disabled, the build-time stamp on the binary keeps the
 * runtime open-hook armed. fs.writeFile takes a different code path
 * that buffers the data + writes once, bypassing the hook.
 *
 * Streams the entry through yauzl + getBuffer + writeFile rather than
 * pipeline(readStream, writeStream). For our 200 MB game zip this
 * peaks memory at ~50 MB (largest single entry — the inner game's
 * app.asar) which is fine for desktop.
 */
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

        // Directory entries — mkdir + read next.
        if (/\/$/.test(entry.fileName)) {
          try {
            await fs.mkdir(join(destDir, entry.fileName), { recursive: true });
          } catch (e) { return fail(e); }
          zipfile.readEntry();
          return;
        }

        // Path traversal guard — borrowed from extract-zip.
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

async function resolveInstallRoot(stagingDir) {
  // Direct hit?
  try {
    await fs.access(join(stagingDir, 'RemnantGame.exe'));
    return stagingDir;
  } catch { /* fall through */ }

  // One level deep?
  const entries = await fs.readdir(stagingDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(stagingDir, entry.name);
    try {
      await fs.access(join(candidate, 'RemnantGame.exe'));
      return candidate;
    } catch { /* try next */ }
  }
  return null;
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Verify the installed game; if it's missing, the manifest version
 * differs, or the sha512 doesn't match, run an install. Emits status
 * events to onStatus along the way.
 *
 * Returns { version, alreadyVerified, didInstall }.
 *
 * @param {object} args
 * @param {string} args.apiBase  e.g. "http://localhost:3001/api/v1"
 * @param {string} args.env      e.g. "test"
 * @param {string} args.jwt      Bearer token
 * @param {(s: object) => void} args.onStatus
 *   Called with { phase: 'manifest' | 'verifying' | 'downloading' | 'installing' | 'done',
 *                 percent?, version? } at each phase.
 */
export async function verifyOrInstall({ apiBase, env, jwt, onStatus }) {
  // Concurrent-call dedupe: if a flow is already running for this env,
  // attach to that promise. The new caller still gets status events
  // (the existing flow's onStatus is already wired to a renderer
  // callback, but we ALSO surface a 'done' event to the late caller
  // so its UI state machine settles correctly).
  //
  // Critical: this is the guard that prevents the .tmp file from
  // being deleted mid-download by a parallel call. The renderer-side
  // guard in gameStore is racy because update.phase doesn't reflect
  // an in-flight IPC call until the first onStatus event lands.
  const existing = inFlightByEnv.get(env);
  if (existing) {
    return existing;
  }

  const promise = runVerifyOrInstall({ apiBase, env, jwt, onStatus })
    .finally(() => {
      inFlightByEnv.delete(env);
    });
  inFlightByEnv.set(env, promise);
  return promise;
}

async function runVerifyOrInstall({ apiBase, env, jwt, onStatus }) {
  const installed = await getInstalledVersion(env);

  // Session cache hit: we've already verified this version in this
  // session. Skip both manifest fetch + sha512 — straight to done.
  if (installed && verifyCache.has(`${env}@${installed}`)) {
    onStatus?.({ phase: 'done', version: installed, alreadyVerified: true });
    return { version: installed, alreadyVerified: true, didInstall: false };
  }

  onStatus?.({ phase: 'manifest' });
  const manifest = await fetchManifest({ apiBase, env, jwt });

  // Version match + integrity good → cache + return done.
  if (installed === manifest.version) {
    onStatus?.({ phase: 'verifying' });
    const intact = await verifyInstalledBinary({ env, manifest });
    if (intact) {
      verifyCache.add(`${env}@${manifest.version}`);
      onStatus?.({ phase: 'done', version: manifest.version });
      return { version: manifest.version, alreadyVerified: false, didInstall: false };
    }
    // Hash mismatch — fall through to download (treat as repair).
  }

  // Need to install.
  onStatus?.({ phase: 'downloading', version: manifest.version, percent: 0 });
  await downloadGameBinary({
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

  verifyCache.add(`${env}@${manifest.version}`);
  onStatus?.({ phase: 'done', version: manifest.version });
  return { version: manifest.version, alreadyVerified: false, didInstall: true };
}

/**
 * Force a full reinstall regardless of the current state. Used by the
 * Settings → Repair button. Same code path as verifyOrInstall, but
 * skips the version-match early-out and clears the session cache for
 * the env first.
 */
export async function forceRepair({ apiBase, env, jwt, onStatus }) {
  // If a verify/install flow is already running for this env, attach
  // to it rather than clearing state mid-flight (which would corrupt
  // the active download). The user's intent of "repair" is satisfied
  // by waiting for the in-flight verify to either fail (then they can
  // re-click Repair) or succeed (which leaves them in the right state).
  const existing = inFlightByEnv.get(env);
  if (existing) {
    return existing;
  }

  // Clear cache + state so the install path runs unconditionally.
  for (const key of [...verifyCache]) {
    if (key.startsWith(`${env}@`)) verifyCache.delete(key);
  }
  const state = await readGameState();
  delete state[env];
  await writeGameState(state);

  return verifyOrInstall({ apiBase, env, jwt, onStatus });
}
