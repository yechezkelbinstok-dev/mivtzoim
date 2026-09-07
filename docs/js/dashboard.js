// Dashboard: every address ever recorded, its coverage, and its latest result.

import { initGate, ensureAuthed } from './auth.js';
import * as store from './store.js';
import { latestVisit, coverageStatus } from './data.js';
import { t, initLangToggle } from './i18n.js';

const interestLabel = (v) => t(`interest_${v}`);
const coverageLabel = (v) => t(`cov_${v}`);
const saveText = (s) => (s === 'idle' ? '' : t(`save_${s}`));

const el = (id) => document.getElementById(id);
const filters = { q: '', route: '', coverage: '', list: '' };

// Filter dropdowns are built from the dictionary so they follow the language.
// Selections are preserved across a language switch.
function renderFilterOptions() {
  const build = (id, options) => {
    const select = el(id);
    const current = select.value;
    select.textContent = '';
    for (const [value, label] of options) {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      select.appendChild(opt);
    }
    select.value = current;
  };

  const codes = new Set();
  for (const addr of (store.get() || { addresses: [] }).addresses) {
    for (const v of addr.visits) if (v.chavrusa) codes.add(v.chavrusa);
    if (addr.last_route) codes.add(addr.last_route);
  }

  build('fRoute', [['', t('route')], ...[...codes].sort().map((c) => [c, c])]);
  build('fCoverage', [
    ['', t('coverage')],
    ['visited', t('cov_visited')],
    ['never', t('cov_never')],
  ]);
  build('fList', [
    ['', t('all')],
    ['list', t('f_list')],
    ['cold', t('f_cold')],
  ]);
}

const ui = initGate({ onAuthed: start });

init();

async function init() {
  initLangToggle(() => {
    el('saveText').textContent = saveText(store.getState());
    renderFilterOptions();
    if (store.get()) {
      renderTiles();
      renderRows();
    }
  });
  renderFilterOptions();
  store.onState((s) => {
    el('saveState').dataset.state = s;
    el('saveText').textContent = saveText(s);
  });
  ['search', 'fRoute', 'fCoverage', 'fList'].forEach((id) =>
    el(id).addEventListener('input', () => {
      filters.q = el('search').value.trim().toLowerCase();
      filters.route = el('fRoute').value;
      filters.coverage = el('fCoverage').value;
      filters.list = el('fList').value;
      renderRows();
    })
  );
  const ok = await ensureAuthed(ui);
  if (ok) start();
}

async function start() {
  try {
    await store.load();
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
  renderFilterOptions();
  renderTiles();
  renderRows();
}

// With nothing imported there is nothing to show, so the board offers the one
// action that changes that rather than an empty table.
function renderEmptyState() {
  const empty = store.get().addresses.length === 0;
  el('boardEmpty').hidden = !empty;
  document.querySelector('.tiles').hidden = empty;
  document.querySelector('.filters').hidden = empty;
  document.querySelector('.table-wrap').hidden = empty;
}

function renderTiles() {
  renderEmptyState();
  const addresses = store.get().addresses;
  const counts = { visited: 0, never: 0 };
  let jewish = 0;
  let onList = 0;
  for (const a of addresses) {
    counts[coverageStatus(a)]++;
    if (a.on_shliach_list) onList++;
    const v = latestVisit(a);
    if (v && v.jewish === true) jewish++;
  }
  const tiles = [
    { num: addresses.length, cap: t('addresses'), tone: '' },
    { num: counts.visited, cap: coverageLabel('visited'), tone: 'fresh' },
    { num: counts.never, cap: coverageLabel('never'), tone: 'never' },
    { num: jewish, cap: t('jewish_yes'), tone: '' },
    { num: onList, cap: t('f_list'), tone: '' },
  ];
  const wrap = el('tiles');
  wrap.textContent = '';
  for (const tile of tiles) {
    const div = document.createElement('div');
    div.className = 'tile';
    if (tile.tone) div.dataset.tone = tile.tone;
    div.innerHTML = `<div class="num">${tile.num}</div><div class="cap"></div>`;
    div.querySelector('.cap').textContent = tile.cap;
    wrap.appendChild(div);
  }
}

function matches(addr) {
  if (filters.q && !addr.address.toLowerCase().includes(filters.q)) return false;
  if (filters.coverage && coverageStatus(addr) !== filters.coverage) return false;
  if (filters.list === 'list' && !addr.on_shliach_list) return false;
  if (filters.list === 'cold' && addr.on_shliach_list) return false;
  if (filters.route) {
    const v = latestVisit(addr);
    const route = (v && v.chavrusa) || addr.last_route;
    if (route !== filters.route) return false;
  }
  return true;
}

function renderRows() {
  const tbody = el('rows');
  tbody.textContent = '';
  const rows = store
    .get()
    .addresses.filter(matches)
    .sort((a, b) => {
      // Most recently visited first; never-visited fall to the end.
      const va = latestVisit(a);
      const vb = latestVisit(b);
      if (!va && !vb) return a.address.localeCompare(b.address);
      if (!va) return 1;
      if (!vb) return -1;
      return va.date < vb.date ? 1 : -1;
    });

  el('rowCount').textContent = rows.length;

  for (const addr of rows) {
    const v = latestVisit(addr);
    const tr = document.createElement('tr');

    // Same treatment as the printed sheet: a list entry is bold and carries
    // the family name under the address.
    const addrCell = document.createElement('td');
    addrCell.className = `ltr addr-cell${addr.on_shliach_list ? ' onlist' : ''}`;
    const line = document.createElement('div');
    line.textContent = addr.address;
    addrCell.appendChild(line);
    if (addr.name_on_list) {
      const nm = document.createElement('div');
      nm.className = 'listname';
      nm.textContent = addr.name_on_list;
      addrCell.appendChild(nm);
    }
    tr.appendChild(addrCell);
    tr.appendChild(td(addr.on_shliach_list ? '★' : ''));

    tr.appendChild(td(v ? `${formatDate(v.date)}` : '—', 'date'));
    tr.appendChild(td(v && v.chavrusa ? v.chavrusa : addr.last_route || ''));
    tr.appendChild(td(v && v.still_there != null ? (v.still_there ? t('yes') : t('no')) : ''));
    tr.appendChild(td(v && v.answered !== null ? (v.answered ? t('answered_yes') : t('answered_no')) : ''));
    tr.appendChild(td(v && v.jewish !== null ? (v.jewish ? t('jewish_yes') : t('jewish_no')) : ''));
    tr.appendChild(td(v && v.interest ? interestLabel(v.interest) : ''));
    tr.appendChild(td(String(addr.visits.length), 'date'));
    tr.appendChild(td(v ? v.notes || '' : '', 'notes'));

    tbody.appendChild(tr);
  }
}

function td(text, cls) {
  const cell = document.createElement('td');
  if (cls) cell.className = cls;
  cell.textContent = text;
  return cell;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}/${y}`;
}

// Surfaces a failed load instead of silently showing an empty page.
function showLoadError() {
  const box = document.getElementById('saveState');
  box.dataset.state = 'error';
  document.getElementById('saveText').textContent = t('load_failed');
}
