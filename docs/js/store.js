// In-memory db + write queue.
//
// Entry is bulk work: one save per address, hundreds per session. So writes
// are serialized (one PUT in flight at a time) and the whole file is written
// from memory rather than refetched each time. Operations are recorded as
// data, not just applied, so a 409 (the other person saved in between) can be
// resolved by refetching and replaying our unsaved operations onto their copy
// instead of clobbering it.

import { fetchDb, saveDb } from './github-api.js';
import { importWeek, recordVisit, addAddress } from './data.js';

let db = null;
let sha = null;
let saving = false;
let pendingOps = [];
let pendingMsg = '';
let state = 'idle';
const listeners = new Set();

export function onState(cb) {
  listeners.add(cb);
  cb(state);
  return () => listeners.delete(cb);
}

function setState(s) {
  state = s;
  listeners.forEach((cb) => cb(s));
}

export function getState() {
  return state;
}

export async function load() {
  const res = await fetchDb();
  db = res.data;
  sha = res.sha;
  if (!db.addresses) db.addresses = [];
  if (!db.weeks) db.weeks = {};
  if (!('currentWeek' in db)) db.currentWeek = null;
  return db;
}

export function get() {
  return db;
}

// Applies an operation to the in-memory db and queues a save.
// op: { kind: 'visit', addressId, result }
//   | { kind: 'address', address, opts }
//   | { kind: 'import', rows, weekId }
export function apply(op, message, { immediate = false } = {}) {
  const result = applyOp(db, op);
  pendingOps.push(op);
  pendingMsg = message || pendingMsg || 'update';
  scheduleSave({ immediate });
  return result;
}

function applyOp(target, op) {
  switch (op.kind) {
    case 'visit':
      return recordVisit(target, op.addressId, op.result);
    case 'address':
      return addAddress(target, op.address, op.opts || {});
    case 'import':
      return importWeek(target, op.rows, op.weekId);
    default:
      throw new Error(`unknown op kind: ${op.kind}`);
  }
}

// Entry is a burst of small edits — one per door, hundreds in a sitting — and
// each save re-uploads the whole file. Rather than a request per door, changes
// are coalesced: a save fires once typing pauses, and no later than MAX_WAIT
// after the first unsaved change so nothing sits in the browser for long.
const DEBOUNCE_MS = 1500;
const MAX_WAIT_MS = 6000;
let debounceTimer = null;
let firstPendingAt = 0;

function scheduleSave({ immediate = false } = {}) {
  if (saving) return; // the in-flight save's tail picks up what's queued
  if (immediate) {
    clearDebounce();
    runSave();
    return;
  }
  const now = Date.now();
  if (!firstPendingAt) firstPendingAt = now;
  if (now - firstPendingAt >= MAX_WAIT_MS) {
    clearDebounce();
    runSave();
    return;
  }
  clearTimeout(debounceTimer);
  const wait = Math.min(DEBOUNCE_MS, MAX_WAIT_MS - (now - firstPendingAt));
  debounceTimer = setTimeout(() => {
    clearDebounce();
    runSave();
  }, wait);
}

function clearDebounce() {
  clearTimeout(debounceTimer);
  debounceTimer = null;
  firstPendingAt = 0;
}

// Writes anything outstanding right now.
export function flush() {
  if (!saving && pendingOps.length) scheduleSave({ immediate: true });
}

async function runSave() {
  if (!pendingOps.length) return;
  saving = true;
  setState('saving');
  // Ops that will be included in this payload: saveDb serializes the db
  // synchronously when called, so anything applied after this point is not.
  const inFlight = pendingOps.length;
  const msg = pendingMsg;
  try {
    sha = await saveDb(db, sha, msg);
    pendingOps = pendingOps.slice(inFlight);
    saving = false;
    if (pendingOps.length) {
      runSave();
    } else {
      pendingMsg = '';
      setState('saved');
    }
  } catch (e) {
    saving = false;
    if (e.status === 409 || e.status === 422) {
      const ok = await replayOntoRemote(msg);
      if (ok) return;
    }
    setState('error');
  }
}

// Refetch the remote copy and replay every unsaved operation onto it.
async function replayOntoRemote(msg) {
  try {
    const fresh = await fetchDb();
    db = fresh.data;
    sha = fresh.sha;
    if (!db.addresses) db.addresses = [];
    if (!db.weeks) db.weeks = {};
    for (const op of pendingOps) {
      try {
        applyOp(db, op);
      } catch {
        // an op that no longer applies to the remote shape is dropped
      }
    }
    saving = true;
    const inFlight = pendingOps.length;
    sha = await saveDb(db, sha, msg);
    pendingOps = pendingOps.slice(inFlight);
    saving = false;
    setState(pendingOps.length ? 'saving' : 'saved');
    if (pendingOps.length) runSave();
    return true;
  } catch {
    saving = false;
    return false;
  }
}

// Retries after an error state (used by the save indicator).
export function retry() {
  if (!saving && pendingOps.length) runSave();
}

export function hasUnsaved() {
  return pendingOps.length > 0;
}
