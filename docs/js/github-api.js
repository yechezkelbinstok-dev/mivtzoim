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

// UTF-8 safe base64 encode (handles Hebrew text in the JSON).
function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

const CONTENTS_URL = `https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents`;

// Looks up db.json's blob sha from the directory listing. The listing stays
// small no matter how large the file is, and the sha is what the next write
// needs for its conflict check.
async function fetchDbSha() {
  const res = await fetch(`${CONTENTS_URL}/?t=${Date.now()}`, {
    headers: authHeaders(),
    cache: 'no-store',
  });
  if (res.status === 404) return null; // empty repo
  if (!res.ok) throw new Error(`listing failed: ${res.status}`);
  const entries = await res.json();
  const entry = Array.isArray(entries) ? entries.find((e) => e.name === DATA_PATH) : null;
  return entry ? entry.sha : null;
}

// Fetches db.json. Returns { data, sha } — data is the empty default shape if
// the file doesn't exist yet.
//
// The content is read with the raw media type rather than the default JSON
// envelope. The envelope base64-encodes the file and is capped at 1 MB, which
// this database passes within a few weeks of entry; raw is served up to 100 MB.
export async function fetchDb() {
  const sha = await fetchDbSha();
  if (!sha) return { data: emptyDb(), sha: null };

  const res = await fetch(`${CONTENTS_URL}/${DATA_PATH}?t=${Date.now()}`, {
    headers: { ...authHeaders(), Accept: 'application/vnd.github.raw' },
    cache: 'no-store',
  });
  if (res.status === 404) return { data: emptyDb(), sha: null };
  if (!res.ok) throw new Error(`fetchDb failed: ${res.status}`);
  const text = await res.text();
  return { data: JSON.parse(text), sha };
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

