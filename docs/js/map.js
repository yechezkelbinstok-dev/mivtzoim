// Map of the shliach's list.
//
// The point of this view is the distinction the list itself cannot make: being
// on the list says nothing about whether anyone has been there. A door only
// counts as done once it has been entered, and then what matters is what the
// entry said — whether the household is still at that address.

import { initGate, ensureAuthed } from './auth.js';
import * as store from './store.js';
import { latestVisit } from './data.js';
import { t, initLangPicker } from './i18n.js';
import { clearToken } from './github-api.js';

const el = (id) => document.getElementById(id);
const saveText = (s) => (s === 'idle' ? '' : t(`save_${s}`));

// The states a listed door can be in, and the colour each gets.
const STATES = {
  pending: '#b9b5ab', // on the list, nobody has entered anything yet
  there: '#1f7a4d', // entered: still there
  gone: '#a33a33', // entered: moved or no longer there
  no_answer: '#3f6d9e', // entered: nobody came to the door
  entered: '#b58227', // entered, but the question was left blank
};
const STATE_KEYS = ['pending', 'there', 'gone', 'no_answer', 'entered'];

function stateOf(addr) {
  const v = latestVisit(addr);
  if (!v) return 'pending';
  if (v.still_there === 'no_answer') return 'no_answer';
  if (v.still_there === true) return 'there';
  if (v.still_there === false) return 'gone';
  return 'entered';
}

let map = null;
let layer = null;
let filter = ''; // '' | one of the state keys
const ui = initGate({ onAuthed: start });

init();

async function init() {
  wireSettings(() => {
    el('saveText').textContent = saveText(store.getState());
    if (store.get()) render();
  });
  store.onState((s) => {
    el('saveState').dataset.state = s;
    el('saveText').textContent = saveText(s);
  });
  const ok = await ensureAuthed(ui);
  if (ok) start();
}

async function start() {
  try {
    await store.load({ onRefresh: render, onAuthError: () => ui.open() });
  } catch (e) {
    if (e.status === 401 || e.status === 403) ui.open();
    else showLoadError();
    return;
  }
  buildMap();
  render();
}

function buildMap() {
  if (map) return;
  map = L.map('map', { zoomControl: true, attributionControl: true });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap contributors © CARTO',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
  layer = L.layerGroup().addTo(map);
}

function pins() {
  return store
    .get()
    .addresses.filter((a) => a.on_shliach_list && a.lat != null && a.lon != null);
}

function render() {
  if (!map) buildMap();
  const all = pins();
  const shown = filter ? all.filter((a) => stateOf(a) === filter) : all;

  layer.clearLayers();
  for (const addr of shown) {
    const state = stateOf(addr);
    const marker = L.circleMarker([addr.lat, addr.lon], {
      radius: 6,
      color: '#fff',
      weight: 1.5,
      fillColor: STATES[state],
      fillOpacity: 0.95,
    });
    marker.bindPopup(popupFor(addr, state), { closeButton: false });
    marker.addTo(layer);
  }

  if (shown.length) {
    map.fitBounds(L.latLngBounds(shown.map((a) => [a.lat, a.lon])), { padding: [40, 40] });
  } else if (all.length) {
    map.fitBounds(L.latLngBounds(all.map((a) => [a.lat, a.lon])), { padding: [40, 40] });
  }

  renderLegend(all);
}

function popupFor(addr, state) {
  const v = latestVisit(addr);
  const wrap = document.createElement('div');
  wrap.className = 'pin';

  const a = document.createElement('div');
  a.className = 'pin-addr ltr';
  a.textContent = addr.address;
  wrap.appendChild(a);

  if (addr.name_on_list) {
    const n = document.createElement('div');
    n.className = 'pin-name';
    n.textContent = addr.name_on_list;
    wrap.appendChild(n);
  }

  const s = document.createElement('div');
  s.className = 'pin-state';
  s.style.color = STATES[state];
  s.textContent = t(`map_${state}`);
  wrap.appendChild(s);

  if (v) {
    const d = document.createElement('div');
    d.className = 'pin-meta';
    const [y, m, day] = v.date.split('-');
    d.textContent = `${Number(m)}/${Number(day)}/${y}${v.chavrusa ? ` · ${t('route')} ${v.chavrusa}` : ''}`;
    wrap.appendChild(d);
    if (v.notes) {
      const nt = document.createElement('div');
      nt.className = 'pin-notes';
      nt.textContent = v.notes;
      wrap.appendChild(nt);
    }
  }
  return wrap;
}

function renderLegend(all) {
  const counts = Object.fromEntries(STATE_KEYS.map((k) => [k, 0]));
  for (const a of all) counts[stateOf(a)]++;

  const wrap = el('legend');
  wrap.textContent = '';

  const total = document.createElement('button');
  total.className = 'legend-item';
  total.setAttribute('aria-pressed', String(filter === ''));
  total.innerHTML = `<span class="legend-num">${all.length}</span><span></span>`;
  total.querySelector('span:last-child').textContent = t('f_list');
  total.addEventListener('click', () => {
    filter = '';
    render();
  });
  wrap.appendChild(total);

  for (const key of STATE_KEYS) {
    if (key === 'entered' && !counts.entered) continue; // rare; hide when unused
    const b = document.createElement('button');
    b.className = 'legend-item';
    b.setAttribute('aria-pressed', String(filter === key));
    b.innerHTML =
      `<span class="legend-dot" style="background:${STATES[key]}"></span>` +
      `<span class="legend-num">${counts[key]}</span><span></span>`;
    b.querySelector('span:last-child').textContent = t(`map_${key}`);
    b.addEventListener('click', () => {
      filter = filter === key ? '' : key;
      render();
    });
    wrap.appendChild(b);
  }
}

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
  el('saveState').dataset.state = 'error';
  el('saveText').textContent = t('load_failed');
}
