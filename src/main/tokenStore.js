// Main-process token persistence using Electron's built-in safeStorage API.
//
// Stores Supabase session tokens (access + refresh + expires_at + email +
// playerId) encrypted via the OS keychain (DPAPI on Windows / Keychain on
// macOS / libsecret on Linux). Persisted to a single JSON file in
// app.getPath('userData') so the data survives launcher self-updates.
//
// Why safeStorage instead of keytar (per original plan): keytar was archived
// + unmaintained Dec 2022. Industry has migrated to safeStorage (VS Code,
// Element, others). Built into Electron — no native module rebuild step.
// Same OS-keychain security model.
//
// Headless-Linux fallback: when safeStorage.isEncryptionAvailable() returns
// false, we plain-write the JSON with a logged warning. Acceptable for the
// staging-audience pre-Steam launcher; full-encrypt becomes a hard
// requirement at Steam launch.

import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import { join } from 'path';

const FILE_NAME = 'session.enc';

function filePath() {
  return join(app.getPath('userData'), FILE_NAME);
}

export async function readTokens() {
  try {
    const buf = await fs.readFile(filePath());
    if (!buf.length) return null;
    if (safeStorage.isEncryptionAvailable()) {
      const json = safeStorage.decryptString(buf);
      return JSON.parse(json);
    }
    // Headless fallback — plain JSON.
    return JSON.parse(buf.toString('utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    // Corrupt or undecryptable — treat as no session, force re-sign-in.
    return null;
  }
}

export async function writeTokens(tokens) {
  const json = JSON.stringify(tokens);
  let payload;
  if (safeStorage.isEncryptionAvailable()) {
    payload = safeStorage.encryptString(json);
  } else {
    payload = Buffer.from(json, 'utf8');
  }
  await fs.writeFile(filePath(), payload, { mode: 0o600 });
}

export async function clearTokens() {
  try {
    await fs.unlink(filePath());
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}
