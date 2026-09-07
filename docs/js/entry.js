// Entry page: import a week's routes, then walk the route entering results.

import { initTokenUI, ensureAuthed } from './auth.js';
import * as store from './store.js';
import { parseCsv, slugify } from './data.js';

const INTEREST_LABEL = { none: 'בכלל לא', some: 'קצת', a_lot: 'הרבה' };
const SAVE_TEXT = { idle: '', saving: 'שומר', saved: 'נשמר', error: 'שגיאה' };

const el = (id) => document.getElementById(id);

let selectedRoute = null;
let currentId = null;
let searchQuery = '';
let draft = { answered: null, jewish: null, interest: null, notes: '' };

const ui = initTokenUI({ onAuthed: start });

init();

async function init() {
  wireSaveState();
  wireChoices();
  wireSearch();
  wireImport();
  wireActions();
  const ok = await ensureAuthed(ui);
  if (ok) start();
}

async function start() {
  try {
    await store.load();
  } catch (e) {
    ui.open();
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
function visibleAddresses() {
  const db = store.get();
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    return db.addresses.filter((a) => a.address.toLowerCase().includes(q)).slice(0, 80);
  }
  const week = db.currentWeek;
  if (!week || !selectedRoute || !week.routes[selectedRoute]) return [];
  return week.routes[selectedRoute].addressIds
    .map((id) => db.addresses.find((a) => a.id === id))
    .filter(Boolean);
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
    const star = addr.on_shliach_list ? '<span class="star">★</span>' : '';
    btn.innerHTML =
      `<span class="idx">${searchQuery ? '' : i + 1}</span>` +
      `<span class="addr ltr"></span>${star}<span class="state-dot"></span>`;
    btn.querySelector('.addr').textContent = addr.address;
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

  const meta = el('cardMeta');
  meta.textContent = '';
  const week = db.currentWeek;
  const route = week ? routeOf(week, addr.id) : null;
  if (route) {
    meta.appendChild(pill(`מסלול ${route}`, 'route'));
    const bochurim = week.routes[route].bochurim;
    if (bochurim) {
      const span = document.createElement('span');
      span.textContent = bochurim;
      meta.appendChild(span);
    }
  }
  if (addr.on_shliach_list) {
    meta.appendChild(pill(addr.name_on_list ? `★ ${addr.name_on_list}` : '★', 'list'));
  }

  setChoices();
  el('fNotes').value = draft.notes;
  renderHistory(addr);
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
    if (v.chavrusa) row.appendChild(pill(v.chavrusa, 'route'));
    if (v.answered !== null) row.appendChild(tag(v.answered ? 'ענו' : 'לא ענו', v.answered));
    if (v.jewish !== null) row.appendChild(tag(v.jewish ? 'יהודי' : 'לא יהודי', v.jewish));
    if (v.interest) row.appendChild(tag(INTEREST_LABEL[v.interest], null));
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
  return `${Number(d)}.${Number(m)}.${y}`;
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
        answered: thisWeek.answered,
        jewish: thisWeek.jewish,
        interest: thisWeek.interest,
        notes: thisWeek.notes || '',
      }
    : { answered: null, jewish: null, interest: null, notes: '' };
  renderList();
  renderCard();
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
}

function save() {
  if (!currentId) return;
  store.apply(
    { kind: 'visit', addressId: currentId, result: { ...draft } },
    `visit: ${currentId}`
  );
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

function wireSearch() {
  el('search').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderRoutes();
    renderList();
  });
}

function wireSaveState() {
  const box = el('saveState');
  store.onState((s) => {
    box.dataset.state = s;
    el('saveText').textContent = SAVE_TEXT[s] || '';
  });
  box.addEventListener('click', () => store.retry());
  window.addEventListener('beforeunload', (e) => {
    if (store.hasUnsaved()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
}

/* ---------------- import ---------------- */

function wireImport() {
  const overlay = el('importOverlay');
  const fileInput = el('fileInput');
  const drop = el('drop');
  const csvText = el('csvText');
  const status = el('importStatus');

  const setStatus = (text, cls) => {
    status.textContent = text;
    status.className = `status-label ${cls || ''}`;
  };

  const openImport = () => {
    overlay.hidden = false;
    csvText.value = '';
    setStatus('');
  };
  el('importBtn').addEventListener('click', openImport);
  el('emptyImport').addEventListener('click', openImport);
  el('importCancel').addEventListener('click', () => {
    overlay.hidden = true;
  });

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (file) csvText.value = await file.text();
  });
  ['dragover', 'dragenter'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('hot');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, () => drop.classList.remove('hot'))
  );
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) csvText.value = await file.text();
  });

  el('importDo').addEventListener('click', () => {
    const rows = parseCsv(csvText.value).filter((r) => (r.address || '').trim());
    if (!rows.length) {
      setStatus('אין שורות', 'bad');
      return;
    }
    const week = store.get().currentWeek;
    const openCount = week
      ? Object.values(week.routes).reduce(
          (n, r) => n + r.addressIds.filter((id) => !week.entered[id]).length,
          0
        )
      : 0;
    if (week && openCount > 0 && !confirm(`החלפת מסלולים — ${openCount} טרם נרשמו`)) return;

    store.apply({ kind: 'import', rows, weekId: todayIso() }, `import ${rows.length} addresses`);
    overlay.hidden = true;
    const codes = Object.keys(store.get().currentWeek.routes);
    selectedRoute = codes.length ? codes[0] : null;
    searchQuery = '';
    el('search').value = '';
    renderAll();
    selectFirstUnentered();
  });
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
