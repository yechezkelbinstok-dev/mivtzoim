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
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

// Fetches db.json. Returns { data, sha } — data is the empty default shape
// if the file doesn't exist yet.
export async function fetchDb() {
  const res = await fetch(
    `https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents/${DATA_PATH}`,
    { headers: authHeaders() }
  );
  if (res.status === 404) {
    return { data: emptyDb(), sha: null };
  }
  if (!res.ok) {
    throw new Error(`fetchDb failed: ${res.status}`);
  }
  const json = await res.json();
  const text = b64ToUtf8(json.content);
  return { data: JSON.parse(text), sha: json.sha };
}

export function emptyDb() {
  return { version: 1, addresses: [], currentWeek: null };
}

// Writes db.json. Retries once on a 409 (someone else saved in between) by
// refetching the latest sha and re-applying `mutate` to the fresh data.
export async function saveDb(data, sha, message) {
  const body = {
    message,
    content: utf8ToB64(JSON.stringify(data, null, 2)),
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

// Read-modify-write helper: fetches the latest db, applies `mutate(data)`,
// saves it, and retries once on a 409 conflict.
export async function updateDb(mutate, message) {
  let { data, sha } = await fetchDb();
  mutate(data);
  try {
    const newSha = await saveDb(data, sha, message);
    return { data, sha: newSha };
  } catch (e) {
    if (e.status === 409) {
      const fresh = await fetchDb();
      mutate(fresh.data);
      const newSha = await saveDb(fresh.data, fresh.sha, message);
      return { data: fresh.data, sha: newSha };
    }
    throw e;
  }
}
