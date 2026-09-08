// Password-gated token vault.
//
// The GitHub token is encrypted with the site password and stored as
// docs/vault.json in the public repo. Everyday use is: type the password, the
// page decrypts the token, and the token is used for api.github.com calls.
// Nobody but the person doing first-time setup ever handles the token itself.
//
// SECURITY, stated plainly: vault.json is public and the password is short, so
// the encryption is a speed bump, not protection. Anyone who finds the repo
// can try every candidate password offline and recover the token. The
// iteration count below makes that take longer; it does not make it hard.
// This is a deliberate, documented tradeoff — see README.

const VAULT_PATH = 'vault.json';
const ITERATIONS = 600000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token));
  return { v: 1, iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

// Returns the token, or null if the password is wrong.
export async function decryptToken(vault, password) {
  try {
    const salt = fromB64(vault.salt);
    const iv = fromB64(vault.iv);
    const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
      'deriveKey',
    ]);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: vault.iterations || ITERATIONS, hash: 'SHA-256' },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromB64(vault.ct));
    return dec.decode(pt);
  } catch {
    return null; // wrong password, or a corrupt vault
  }
}

// Reads the vault from the site itself. Returns null when setup hasn't run.
export async function fetchVault() {
  try {
    const res = await fetch(`${VAULT_PATH}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const json = await res.json();
    return json && json.ct ? json : null;
  } catch {
    return null;
  }
}

// Writes vault.json into the public site repo, using the token being stored.
// Only ever called once, during first-time setup.
export async function publishVault(vault, token, siteRepo) {
  const url = `https://api.github.com/repos/${siteRepo}/contents/docs/${VAULT_PATH}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
  let sha = null;
  const existing = await fetch(url, { headers });
  if (existing.ok) sha = (await existing.json()).sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'Set site password',
      content: btoa(JSON.stringify(vault, null, 2)),
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `publish failed: ${res.status}`);
  }
}
