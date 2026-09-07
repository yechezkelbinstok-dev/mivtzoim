// Dashboard: every address ever recorded, its coverage, and its latest result.

import { initTokenUI, ensureAuthed } from './auth.js';
import * as store from './store.js';
import { latestVisit, coverageStatus } from './data.js';

const INTEREST_LABEL = { none: 'בכלל לא', some: 'קצת', a_lot: 'הרבה' };
const COVERAGE_LABEL = { fresh: 'עדכני', stale: 'מתיישן', old: 'ישן', never: 'טרם' };
const SAVE_TEXT = { idle: '', saving: 'שומר', saved: 'נשמר', error: 'שגיאה' };

const el = (id) => document.getElementById(id);
const filters = { q: '', route: '', coverage: '', list: '' };

const ui = initTokenUI({ onAuthed: start });

init();

async function init() {
  store.onState((s) => {
    el('saveState').dataset.state = s;
    el('saveText').textContent = SAVE_TEXT[s] || '';
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
  } catch {
    ui.open();
    return;
  }
  renderRouteOptions();
  renderTiles();
  renderRows();
}

function renderRouteOptions() {
  const codes = new Set();
  for (const addr of store.get().addresses) {
    for (const v of addr.visits) if (v.chavrusa) codes.add(v.chavrusa);
    if (addr.last_route) codes.add(addr.last_route);
  }
  const select = el('fRoute');
  [...codes].sort().forEach((code) => {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = code;
    select.appendChild(opt);
  });
}

function renderTiles() {
  const addresses = store.get().addresses;
  const counts = { fresh: 0, stale: 0, old: 0, never: 0 };
  let jewish = 0;
  let onList = 0;
  for (const a of addresses) {
    counts[coverageStatus(a)]++;
    if (a.on_shliach_list) onList++;
    const v = latestVisit(a);
    if (v && v.jewish === true) jewish++;
  }
  const tiles = [
    { num: addresses.length, cap: 'כתובות', tone: '' },
    { num: counts.fresh, cap: COVERAGE_LABEL.fresh, tone: 'fresh' },
    { num: counts.stale, cap: COVERAGE_LABEL.stale, tone: 'stale' },
    { num: counts.old, cap: COVERAGE_LABEL.old, tone: 'old' },
    { num: counts.never, cap: COVERAGE_LABEL.never, tone: 'never' },
    { num: jewish, cap: 'יהודי', tone: '' },
    { num: onList, cap: '★ רשימה', tone: '' },
  ];
  const wrap = el('tiles');
  wrap.textContent = '';
  for (const t of tiles) {
    const div = document.createElement('div');
    div.className = 'tile';
    if (t.tone) div.dataset.tone = t.tone;
    div.innerHTML = `<div class="num">${t.num}</div><div class="cap"></div>`;
    div.querySelector('.cap').textContent = t.cap;
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
    const cov = coverageStatus(addr);
    const tr = document.createElement('tr');

    tr.appendChild(td(addr.address, 'ltr'));
    tr.appendChild(td(addr.on_shliach_list ? (addr.name_on_list ? `★ ${addr.name_on_list}` : '★') : ''));

    const covCell = document.createElement('td');
    covCell.innerHTML = `<span class="cov"><span class="state-dot" data-cov="${cov}"></span><span></span></span>`;
    covCell.querySelector('.cov span:last-child').textContent = COVERAGE_LABEL[cov];
    tr.appendChild(covCell);

    tr.appendChild(td(v ? `${formatDate(v.date)}` : '—', 'date'));
    tr.appendChild(td(v && v.chavrusa ? v.chavrusa : addr.last_route || ''));
    tr.appendChild(td(v && v.answered !== null ? (v.answered ? 'ענו' : 'לא ענו') : ''));
    tr.appendChild(td(v && v.jewish !== null ? (v.jewish ? 'יהודי' : 'לא יהודי') : ''));
    tr.appendChild(td(v && v.interest ? INTEREST_LABEL[v.interest] : ''));
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
  return `${Number(d)}.${Number(m)}.${y}`;
}
