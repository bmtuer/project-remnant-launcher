// Per-realm game-binary install + verify + update.
//
// Protocol:
//   1. Fetch manifest from <game-api>/launcher/game-update-info?env={env}
//      → server 302s to GitHub-signed latest.yml URL
//      → we follow + parse YAML
//   2. Manifest declares: version, file path (relative to manifest URL),
//      sha512 of the .exe
//   3. Compare manifest version to per-realm installed version (from
//      userData/game-state.json)
//   4. If outdated or missing: download via /launcher/game-binary?env=X&version=Y
//      → server 302s to GitHub-signed .exe URL
//      → we stream bytes to disk while computing sha512
//   5. Verify sha512 matches manifest; on success, atomic-rename into
//      place + update game-state.json
//
// Session cache:
//   Once a verify succeeds for an (env, version) pair, remember it
//   in-memory until launcher restart. Subsequent Play clicks on the
//   same (env, version) skip the verify+update step. Mirrors the
//   Battle.net pattern.
//
// Per-realm install:
//   %APPDATA%/RemnantLauncher/game/{env}/RemnantGame.exe
//   gameSpawner.js already resolves binaries from this layout.
//
// State file:
//   %APPDATA%/RemnantLauncher/game-state.json
//   { test: { version: '0.7.2', sha512: '...', installedAt: '...' } }
//
// Emits progress to the renderer via 'game-update:status' events.

import { app } from 'electron';
import { promises as fs, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const GAME_INSTALL_ROOT = join(app.getPath('appData'), 'RemnantLauncher', 'game');
const GAME_STATE_FILE   = join(app.getPath('appData'), 'RemnantLauncher', 'game-state.json');

// Session-only verify cache: { 'test@0.7.2': true }. Cleared on
// launcher restart. Set by verifyOrInstall() when a verify succeeds;
// future Play clicks for the same key skip straight to spawn.
const verifyCache = new Set();

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
// 302 to the GitHub-signed URL of the latest release's latest.yml.
// We pass through fetch + follow redirects automatically (the spike
// validated this works), then parse YAML.
//
// latest.yml shape (simplified):
//   version: 0.7.2
//   files:
//     - url: Project-Remnant-Setup-0.7.2.exe
//       sha512: <base64>
//       size: 200000000
//   path: Project-Remnant-Setup-0.7.2.exe
//   sha512: <base64>
//   releaseDate: '2026-04-22T...'
async function fetchManifest({ apiBase, env, jwt }) {
  const url = `${apiBase}/launcher/game-update-info?env=${encodeURIComponent(env)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) {
    throw new Error(`Manifest fetch ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const yamlText = await res.text();
  return parseManifest(yamlText);
}

// Minimal YAML parser scoped to electron-builder's latest.yml shape.
// We don't need a full YAML library — only the fields we consume:
// version, path (filename), sha512, size. Single-level keys, plain
// scalar values, no nested maps or arrays of maps for the fields we
// extract. The `files:` array we ignore; `path` + top-level sha512
// are what electron-updater traditionally consumes.
function parseManifest(yamlText) {
  const out = {};
  const lines = yamlText.split('\n');
  for (const line of lines) {
    // Skip indented lines + blank lines + comments
    if (!line || /^\s/.test(line) || line.startsWith('#')) continue;
    const m = line.match(/^([A-Za-z0-9_]+):\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    out[key] = value.replace(/^['"]|['"]$/g, '');
  }
  if (!out.version || !out.path || !out.sha512) {
    throw new Error(`Manifest missing required fields. Got keys: ${Object.keys(out).join(', ')}`);
  }
  return {
    version: out.version,
    path:    out.path,
    sha512:  out.sha512,
    size:    out.size ? Number(out.size) : null,
  };
}

// ─── Verify ────────────────────────────────────────────────────
//
// Read the installed binary, compute sha512, compare to the manifest's
// sha512. Both are base64-encoded (electron-builder's convention).
// Returns true if matching, false if mismatch (or file missing).
async function verifyInstalledBinary({ env, manifest }) {
  const binaryPath = gameBinaryPath(env);
  try {
    await fs.access(binaryPath);
  } catch {
    return false;  // No binary installed yet
  }
  const buf = await fs.readFile(binaryPath);
  const hash = createHash('sha512').update(buf).digest('base64');
  return hash === manifest.sha512;
}

// ─── Download ──────────────────────────────────────────────────
//
// Stream the .exe from /launcher/game-binary into the per-realm
// install dir. We compute sha512 in-flight so we don't have to read
// the file again post-download. Atomic-rename pattern: write to a
// .tmp file first, verify, then rename to RemnantGame.exe so a
// crashed download never leaves a half-written binary in place.
//
// Progress is emitted to the renderer every ~100ms as a percent +
// downloaded bytes. The progress hook is a function the caller
// provides; main wires it to a webContents.send('game-update:status').
async function downloadGameBinary({ apiBase, env, version, jwt, manifest, onProgress }) {
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

  const targetDir = gameDirForEnv(env);
  await fs.mkdir(targetDir, { recursive: true });
  const finalPath = join(targetDir, 'RemnantGame.exe');
  const tempPath  = `${finalPath}.tmp`;

  // Drop any prior .tmp from a crashed previous download.
  try { await fs.unlink(tempPath); } catch { /* ignore */ }

  const out = createWriteStream(tempPath);
  let lastProgressEmit = 0;

  const tap = new ReadableTap(res.body, (chunk) => {
    hash.update(chunk);
    downloaded += chunk.length;
    const now = Date.now();
    if (now - lastProgressEmit >= 100) {
      lastProgressEmit = now;
      const percent = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
      onProgress?.({ percent, downloaded, total });
    }
  });

  await pipeline(tap, out);

  // Final progress emit at 100%.
  onProgress?.({ percent: 100, downloaded, total });

  // Verify sha512 before promoting .tmp → RemnantGame.exe.
  const computed = hash.digest('base64');
  if (computed !== manifest.sha512) {
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw new Error(`sha512 mismatch — download corrupted (got ${computed.slice(0, 16)}…, expected ${manifest.sha512.slice(0, 16)}…)`);
  }

  // Atomic-ish rename. On Windows, rename across directories is not
  // atomic, but within the same dir it is.
  try { await fs.unlink(finalPath); } catch { /* ignore — first install */ }
  await fs.rename(tempPath, finalPath);

  // Update state file.
  const state = await readGameState();
  state[env] = {
    version: manifest.version,
    sha512:  manifest.sha512,
    installedAt: new Date().toISOString(),
  };
  await writeGameState(state);
}

/**
 * Tap a Web Stream / Node stream so we can observe each chunk
 * (for progress + sha512 hashing) without buffering the whole
 * payload. Wraps a fetch's response.body (a Web ReadableStream)
 * into a Node Readable that the pipeline can consume.
 */
class ReadableTap extends Readable {
  constructor(webStream, onChunk) {
    super();
    this._reader = webStream.getReader();
    this._onChunk = onChunk;
    this._reading = false;
  }
  async _read() {
    if (this._reading) return;
    this._reading = true;
    try {
      const { value, done } = await this._reader.read();
      if (done) {
        this.push(null);
        return;
      }
      this._onChunk(value);
      this.push(Buffer.from(value));
    } catch (err) {
      this.destroy(err);
    } finally {
      this._reading = false;
    }
  }
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
  });

  onStatus?.({ phase: 'installing', version: manifest.version });
  // No further work — downloadGameBinary already atomically promoted
  // the .tmp into place + updated the state file. "installing" phase
  // exists for UI symmetry with the v2 differential-update path that
  // would do block-map application here.

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
  // Clear cache + state so the install path runs unconditionally.
  for (const key of [...verifyCache]) {
    if (key.startsWith(`${env}@`)) verifyCache.delete(key);
  }
  const state = await readGameState();
  delete state[env];
  await writeGameState(state);

  return verifyOrInstall({ apiBase, env, jwt, onStatus });
}
