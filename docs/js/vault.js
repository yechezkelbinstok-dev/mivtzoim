// Browser-local password-gated token vault. Setup is required per browser.
// Never fetch or publish encrypted credentials through the public repository.
// The active token is still cached by github-api.js; this password is not a
// security boundary against someone with access to the browser or its storage.

const VAULT_KEY = 'mivtzoim_local_vault';
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

// Reads only this browser's vault. Old public vaults are deliberately ignored.
export async function fetchVault() {
  try {
    const json = JSON.parse(localStorage.getItem(VAULT_KEY));
    return json && json.ct ? json : null;
  } catch {
    return null;
  }
}

// Save locally; no token or public-repository permission is needed.
export async function saveVault(vault) {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}
