// Entry page: import a week's routes, then walk the route entering results.

import { initGate, ensureAuthed } from './auth.js';
import * as store from './store.js';
import { slugify, bochurimFor } from './data.js';
import { t, initLangPicker } from './i18n.js';
import { clearToken } from './github-api.js';

const interestLabel = (v) => t(`interest_${v}`);
const saveText = (s) => (s === 'idle' ? '' : t(`save_${s}`));

// still_there is three-valued: the household is there, it is not, or nobody
// came to the door. Stored as true / false / 'no_answer'; older entries hold
// only the two booleans and keep reading correctly.
const parseStill = (v) => (v === 'no_answer' ? 'no_answer' : v === 'true');
const stillLabel = (v) => (v === 'no_answer' ? t('answered_no') : v ? t('yes') : t('no'));

const el = (id) => document.getElementById(id);

let selectedRoute = null;
let currentId = null;
let searchQuery = '';
let kindFilter = ''; // '' | 'list' | 'cold'
let draft = { still_there: null, answered: null, jewish: null, interest: null, notes: '' };

const ui = initGate({ onAuthed: start });

init();

async function init() {
  wireSettings(() => {
    el('saveText').textContent = saveText(store.getState());
    if (store.get()) renderAll();
  });
  wireSaveState();
  wireChoices();
  wireKindFilter();
  wireSearch();
  wireActions();
  const ok = await ensureAuthed(ui);
  if (ok) start();
}

async function start() {
  try {
    // Renders from this browser's cached copy at once when there is one, and
    // redraws only if the background refresh actually brings something new.
    await store.load({
      onRefresh: () => {
        renderAll();
        if (selectedRoute && !currentId) selectFirstUnentered();
      },
      onAuthError: () => ui.open(),
    });
  } catch (e) {
    // A failed read is an error, not an empty database. Never render the page
    // as though there were no data.
    if (e.status === 401 || e.status === 403) {
      ui.open();
    } else {
      showLoadError();
    }
    return;
  }
  const week = store.get().currentWeek;
  if (week) {
    const codes = Object.keys(week.routes || {});
    selectedRoute = codes.length ? codes[0] : null;
  }
  renderAll();
  if (selectedRoute) selectFirstUnentered();
}

/* ---------------- rendering ---------------- */

function renderAll() {
  renderWeek();
  renderRoutes();
  renderList();
  renderCard();
  renderContext();
}

function renderWeek() {
  const week = store.get().currentWeek;
  el('weekId').textContent = week ? formatDate(week.weekId) : '—';
}

function renderRoutes() {
  const wrap = el('routes');
  wrap.textContent = '';
  const week = store.get().currentWeek;
  if (!week) return;
  for (const code of Object.keys(week.routes)) {
    const route = week.routes[code];
    const total = route.addressIds.length;
    const done = route.addressIds.filter((id) => week.entered[id]).length;
    const btn = document.createElement('button');
    btn.className = 'route-chip';
    btn.setAttribute('aria-pressed', String(code === selectedRoute && !searchQuery));
    btn.dataset.done = String(done === total && total > 0);
    btn.innerHTML = `<span>${code}</span><span class="count">${done}/${total}</span>`;
    btn.addEventListener('click', () => {
      selectedRoute = code;
      searchQuery = '';
      el('search').value = '';
      renderRoutes();
      renderList();
      selectFirstUnentered();
    });
    wrap.appendChild(btn);
  }
}

// The rows currently shown in the rail: this week's route, or search results
// across every address ever recorded.
function matchesKind(addr) {
  if (kindFilter === 'list') return !!addr.on_shliach_list;
  if (kindFilter === 'cold') return !addr.on_shliach_list;
  return true;
}

function visibleAddresses() {
  const db = store.get();
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    return db.addresses
      .filter((a) => a.address.toLowerCase().includes(q) && matchesKind(a))
      .slice(0, 80);
  }
  const week = db.currentWeek;
  if (!week || !selectedRoute || !week.routes[selectedRoute]) return [];
  return week.routes[selectedRoute].addressIds
    .map((id) => db.addresses.find((a) => a.id === id))
    .filter((a) => a && matchesKind(a));
}

function renderList() {
  const list = el('addrList');
  list.textContent = '';
  const db = store.get();
  const week = db.currentWeek;
  const rows = visibleAddresses();

  if (searchQuery) {
    const exists = db.addresses.some((a) => a.id === slugify(searchQuery));
    if (!exists) {
      const add = document.createElement('button');
      add.className = 'addr-row';
      add.id = 'addRow';
      add.innerHTML = `<span class="idx">＋</span><span class="addr ltr"></span>`;
      add.querySelector('.addr').textContent = searchQuery.trim();
      add.addEventListener('click', () => addNewAddress(searchQuery.trim()));
      list.appendChild(add);
    }
  }

  if (!rows.length && !searchQuery) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '—';
    list.appendChild(empty);
    return;
  }

  rows.forEach((addr, i) => {
    const entered = week ? !!week.entered[addr.id] : false;
    const btn = document.createElement('button');
    btn.className = 'addr-row';
    btn.dataset.entered = String(entered);
    btn.dataset.id = addr.id;
    btn.setAttribute('aria-current', String(addr.id === currentId));
    btn.dataset.onlist = String(!!addr.on_shliach_list);
    const star = addr.on_shliach_list ? '<span class="star">★</span>' : '';
    btn.innerHTML =
      `<span class="idx">${searchQuery ? '' : i + 1}</span>` +
      `<span class="stack"><span class="addr ltr"></span>` +
      (addr.name_on_list ? `<span class="listname"></span>` : '') +
      `</span>${star}<span class="state-dot"></span>`;
    btn.querySelector('.addr').textContent = addr.address;
    if (addr.name_on_list) btn.querySelector('.listname').textContent = addr.name_on_list;
    btn.addEventListener('click', () => select(addr.id));
    list.appendChild(btn);
  });
}

function renderCard() {
  const db = store.get();
  const addr = db.addresses.find((a) => a.id === currentId);
  el('workCard').hidden = !addr;
  el('workEmpty').hidden = !!addr;
  if (!addr) return;

  el('cardAddr').textContent = addr.address;
  el('cardAddr').classList.toggle('onlist', !!addr.on_shliach_list);
  const nameLine = el('cardName');
  nameLine.textContent = addr.name_on_list || '';
  nameLine.hidden = !addr.name_on_list;

  const meta = el('cardMeta');
  meta.textContent = '';
  const week = db.currentWeek;
  const route = week ? routeOf(week, addr.id) : null;
  if (route) {
    meta.appendChild(pill(`${t('route')} ${route}`, 'route'));
    const bochurim = week.routes[route].bochurim;
    if (bochurim) {
      const span = document.createElement('span');
      span.textContent = bochurim;
      meta.appendChild(span);
    }
  }
  if (addr.on_shliach_list) meta.appendChild(pill(t('f_list'), 'list'));

  // A shliach's-list door is not scored on answered/Jewish/interest — the
  // printed sheet replaces those columns entirely. Notes still apply.
  const onList = !!addr.on_shliach_list;
  el('fieldStill').hidden = !onList;
  el('fieldAnswered').hidden = onList;
  el('fieldJewish').hidden = onList;
  el('fieldInterest').hidden = onList;

  setChoices();
  el('fNotes').value = draft.notes;
  renderHistory(addr);
}

// Where an address sits in the sequence it belongs to: this week's route if it
// is on one, otherwise the shliach's list in the list's own order. Searching
// pulls a door out of that sequence, and this is what puts it back.
function placementOf(id) {
  const db = store.get();
  const week = db.currentWeek;
  const byId = (x) => db.addresses.find((a) => a.id === x);
  if (week) {
    const code = routeOf(week, id);
    if (code) {
      return {
        label: `${t('route')} ${code}`,
        rows: week.routes[code].addressIds.map(byId).filter(Boolean),
      };
    }
  }
  const addr = byId(id);
  if (addr && addr.on_shliach_list) {
    return { label: t('f_list'), rows: db.addresses.filter((a) => a.on_shliach_list) };
  }
  return null;
}

// Shown while a search is in play: the rail is search results then, so this is
// the only thing left holding the door's place in its list. Off the far side of
// the card, opposite the search.
function renderContext() {
  const panel = el('context');
  const place = searchQuery && currentId ? placementOf(currentId) : null;
  const idx = place ? place.rows.findIndex((a) => a.id === currentId) : -1;
  panel.hidden = !place || idx < 0;
  document.querySelector('main.entry').classList.toggle('with-context', !panel.hidden);
  if (panel.hidden) return;

  el('ctxLabel').textContent = place.label;
  el('ctxPos').textContent = `${idx + 1} / ${place.rows.length}`;
  el('ctxPrev').disabled = idx === 0;
  el('ctxNext').disabled = idx === place.rows.length - 1;

  const week = store.get().currentWeek;
  const list = el('ctxList');
  list.textContent = '';
  place.rows.forEach((addr, i) => {
    const btn = document.createElement('button');
    btn.className = 'addr-row';
    btn.dataset.entered = String(week ? !!week.entered[addr.id] : false);
    btn.dataset.onlist = String(!!addr.on_shliach_list);
    btn.setAttribute('aria-current', String(addr.id === currentId));
    btn.innerHTML =
      `<span class="idx">${i + 1}</span>` +
      `<span class="stack"><span class="addr ltr"></span>` +
      (addr.name_on_list ? `<span class="listname"></span>` : '') +
      `</span><span class="state-dot"></span>`;
    btn.querySelector('.addr').textContent = addr.address;
    if (addr.name_on_list) btn.querySelector('.listname').textContent = addr.name_on_list;
    btn.addEventListener('click', () => select(addr.id));
    list.appendChild(btn);
  });

  const current = list.querySelector('[aria-current="true"]');
  if (current) current.scrollIntoView({ block: 'center' });
}

// One step along the list the current door sits on, in the list's own order —
// not the next search result, and not the next unentered door.
function step(delta) {
  const place = currentId ? placementOf(currentId) : null;
  if (!place) return;
  const next = place.rows[place.rows.findIndex((a) => a.id === currentId) + delta];
  if (next) select(next.id);
}

function pill(text, cls) {
  const s = document.createElement('span');
  s.className = `pill ${cls}`;
  s.textContent = text;
  return s;
}

function renderHistory(addr) {
  const week = store.get().currentWeek;
  const weekId = week ? week.weekId : null;
  const past = addr.visits.filter((v) => v.week !== weekId).sort((a, b) => (a.date < b.date ? 1 : -1));
  el('history').hidden = past.length === 0;
  const rows = el('historyRows');
  rows.textContent = '';
  for (const v of past) {
    const row = document.createElement('div');
    row.className = 'visit-row';
    const date = document.createElement('span');
    date.className = 'visit-date';
    date.textContent = formatDate(v.date);
    row.appendChild(date);
    if (v.chavrusa) {
      const routePill = pill(v.chavrusa, 'route');
      const who = bochurimFor(store.get(), v);
      if (who) routePill.title = who;
      row.appendChild(routePill);
    }
    if (v.still_there != null)
      row.appendChild(
        tag(stillLabel(v.still_there), v.still_there === 'no_answer' ? null : v.still_there)
      );
    if (v.answered !== null) row.appendChild(tag(v.answered ? t('answered_yes') : t('answered_no'), v.answered));
    if (v.jewish !== null) row.appendChild(tag(v.jewish ? t('jewish_yes') : t('jewish_no'), v.jewish));
    if (v.interest) row.appendChild(tag(interestLabel(v.interest), null));
    const notes = document.createElement('span');
    notes.className = 'visit-notes';
    notes.textContent = v.notes || '';
    row.appendChild(notes);
    rows.appendChild(row);
  }
}

function tag(text, positive) {
  const s = document.createElement('span');
  s.className = `tag ${positive === null ? 'neutral' : positive ? 'yes' : 'no'}`;
  s.textContent = text;
  return s;
}

function routeOf(week, addressId) {
  for (const code of Object.keys(week.routes || {})) {
    if (week.routes[code].addressIds.includes(addressId)) return code;
  }
  return null;
}

function formatDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y}`;
}

/* ---------------- selection ---------------- */

function select(id) {
  currentId = id;
  const addr = store.get().addresses.find((a) => a.id === id);
  const week = store.get().currentWeek;
  const weekId = week ? week.weekId : null;
  const thisWeek = addr ? addr.visits.find((v) => v.week === weekId) : null;
  draft = thisWeek
    ? {
        still_there: thisWeek.still_there ?? null,
        answered: thisWeek.answered,
        jewish: thisWeek.jewish,
        interest: thisWeek.interest,
        notes: thisWeek.notes || '',
      }
    : { still_there: null, answered: null, jewish: null, interest: null, notes: '' };
  renderList();
  renderCard();
  renderContext();
}

function selectFirstUnentered() {
  const week = store.get().currentWeek;
  const rows = visibleAddresses();
  if (!rows.length) {
    currentId = null;
    renderCard();
    return;
  }
  const next = week ? rows.find((a) => !week.entered[a.id]) : null;
  select((next || rows[0]).id);
}

function advance() {
  // Reached by search, the next door is the next one on that door's own list —
  // the search results are an arbitrary ordering and stepping through them is
  // not what anyone means by carrying on.
  if (searchQuery) {
    const place = currentId ? placementOf(currentId) : null;
    if (place) {
      const idx = place.rows.findIndex((a) => a.id === currentId);
      if (place.rows[idx + 1]) select(place.rows[idx + 1].id);
      else renderAll();
      return;
    }
  }
  const week = store.get().currentWeek;
  const rows = visibleAddresses();
  const idx = rows.findIndex((a) => a.id === currentId);
  const after = rows.slice(idx + 1);
  const next =
    (week ? after.find((a) => !week.entered[a.id]) : after[0]) ||
    (week ? rows.find((a) => !week.entered[a.id]) : null) ||
    after[0];
  if (next) select(next.id);
  else renderAll();
}

/* ---------------- inputs ---------------- */

function wireChoices() {
  bindGroup('fStill', 'still_there', parseStill);
  bindGroup('fAnswered', 'answered', (v) => v === 'true');
  bindGroup('fJewish', 'jewish', (v) => v === 'true');
  bindGroup('fInterest', 'interest', (v) => v);
  el('fNotes').addEventListener('input', (e) => {
    draft.notes = e.target.value;
  });
  el('fNotes').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
  });
}

function bindGroup(groupId, key, parse) {
  el(groupId).addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (!btn) return;
    const value = parse(btn.dataset.value);
    draft[key] = draft[key] === value ? null : value;
    setChoices();
  });
}

function setChoices() {
  setGroup('fStill', (v) => draft.still_there !== null && parseStill(v) === draft.still_there);
  setGroup('fAnswered', (v) => (v === 'true') === draft.answered && draft.answered !== null);
  setGroup('fJewish', (v) => (v === 'true') === draft.jewish && draft.jewish !== null);
  setGroup('fInterest', (v) => v === draft.interest);
}

function setGroup(groupId, isOn) {
  el(groupId)
    .querySelectorAll('.choice')
    .forEach((btn) => btn.setAttribute('aria-pressed', String(!!isOn(btn.dataset.value))));
}

function wireActions() {
  el('saveBtn').addEventListener('click', save);
  el('skipBtn').addEventListener('click', advance);
  el('ctxPrev').addEventListener('click', () => step(-1));
  el('ctxNext').addEventListener('click', () => step(1));
}

function save() {
  if (!currentId) return;
  const addr = store.get().addresses.find((a) => a.id === currentId);
  // A shliach's-list door records whether the household is still there, plus
  // notes. A cold door records the ordinary three and never still_there.
  const result = addr && addr.on_shliach_list
    ? {
        still_there: draft.still_there,
        answered: null,
        jewish: null,
        interest: null,
        notes: draft.notes,
      }
    : { ...draft, still_there: null };
  store.apply({ kind: 'visit', addressId: currentId, result }, `visit: ${currentId}`);
  advance();
  renderRoutes();
}

function addNewAddress(address) {
  if (!address) return;
  const addr = store.apply(
    { kind: 'address', address, opts: { chavrusa: selectedRoute || '' } },
    `address: ${address}`
  );
  searchQuery = '';
  el('search').value = '';
  renderAll();
  select(addr.id);
}

function wireKindFilter() {
  el('kindFilter').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    kindFilter = btn.dataset.kind;
    el('kindFilter')
      .querySelectorAll('button')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === kindFilter)));
    renderList();
    selectFirstUnentered();
  });
}

function wireSearch() {
  el('search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderRoutes();
    renderList();
    renderContext();
  });
}

function wireSaveState() {
  const box = el('saveState');
  store.onState((s) => {
    box.dataset.state = s;
    el('saveText').textContent = saveText(s);
  });
  box.addEventListener('click', () => store.retry());
  // Saves are debounced, so anything typed in the last moment would otherwise
  // sit in the browser when the tab is switched away or closed.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') store.flush();
  });
  window.addEventListener('beforeunload', (e) => {
    if (store.hasUnsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}


// Surfaces a failed load instead of silently showing an empty page.

// Settings: language, and signing this browser out. Signing out drops the
// token and the cached copy of the database, since both are this machine's.
function wireSettings(onLangChange) {
  const overlay = el('settingsOverlay');
  initLangPicker(onLangChange);
  el('settingsBtn').addEventListener('click', () => {
    overlay.hidden = false;
  });
  el('settingsClose').addEventListener('click', () => {
    overlay.hidden = true;
  });
  el('signOut').addEventListener('click', () => {
    clearToken();
    store.clearCache();
    location.reload();
  });
}

function showLoadError() {
  const box = document.getElementById('saveState');
  box.dataset.state = 'error';
  document.getElementById('saveText').textContent = t('load_failed');
}
