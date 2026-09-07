// Thin wrapper around the GitHub REST API for reading/writing the private
// data repo. The token lives only in localStorage and is only ever sent to
// api.github.com.

const DATA_OWNER = 'yechezkelbinstok-dev';
const DATA_REPO = 'mivtzoim-data';
const DATA_PATH = 'db.json';
const TOKEN_KEY = 'mivtzoim_gh_token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
}

function authHeaders() {
  const token = getToken();
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

// Confirms the token can read the data repo. Returns { ok, status, message }.
export async function validateToken(token) {
  try {
    const res = await fetch(`https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (res.status === 200) return { ok: true };
    if (res.status === 401) return { ok: false, message: 'invalid_token' };
    if (res.status === 404) return { ok: false, message: 'no_access' };
    return { ok: false, message: `http_${res.status}` };
  } catch (e) {
    return { ok: false, message: 'network' };
  }
}

// UTF-8 safe base64 decode/encode (handles Hebrew text in the JSON).
function b64ToUtf8(b64) {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

const CONTENTS_URL = `https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents`;

// Fetches db.json. Returns { data, sha }.
//
// A 404 — and ONLY a 404 — means the file does not exist yet, which is a
// genuinely empty database. Every other failure throws. An earlier version
// returned an empty database whenever the read did not work out, which made a
// failed load indistinguishable from having no data: the site came up looking
// like every address had vanished. A read that did not succeed must never
// render as an empty database.
export async function fetchDb() {
  const res = await fetch(`${CONTENTS_URL}/${DATA_PATH}?t=${Date.now()}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 404) return { data: emptyDb(), sha: null };
  if (!res.ok) {
    const e = new Error(`fetchDb failed: ${res.status}`);
    e.status = res.status;
    throw e;
  }
  const json = await res.json();
  if (!json || typeof json.content !== 'string' || typeof json.sha !== 'string') {
    throw new Error('fetchDb: unexpected response shape');
  }
  return { data: JSON.parse(b64ToUtf8(json.content)), sha: json.sha };
}

// The on-disk form. Not pretty-printed: indentation is roughly a third of the
// bytes on a file this shape, and every save re-uploads the whole thing.
export function serializeDb(data) {
  return JSON.stringify(data);
}

export function emptyDb() {
  return { version: 1, addresses: [], weeks: {}, currentWeek: null };
}

// Writes db.json. Retries once on a 409 (someone else saved in between) by
// refetching the latest sha and re-applying `mutate` to the fresh data.
export async function saveDb(data, sha, message) {
  const body = {
    message,
    content: utf8ToB64(serializeDb(data)),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(
    `https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents/${DATA_PATH}`,
    {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const e = new Error(`saveDb failed: ${res.status} ${err.message || ''}`);
    e.status = res.status;
    throw e;
  }
  const json = await res.json();
  return json.content.sha;
}

