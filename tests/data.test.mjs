// Plain-node sanity checks for docs/js/data.js — run with:
//   node tests/data.test.mjs
// No test framework dependency on purpose (keeps the site build-free).

import assert from 'node:assert/strict';
import {
  parseCsv,
  importWeek,
  recordVisit,
  addAddress,
  bochurimFor,
  slugify,
  latestVisit,
  daysSince,
  coverageStatus,
  CHAVRUSA_CODES,
} from '../docs/js/data.js';
import { serializeDb } from '../docs/js/github-api.js';

function emptyDb() {
  return { version: 1, addresses: [], currentWeek: null };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

const sampleCsv = `chavrusa,bochurim,address,on_shliach_list,name_on_list,answered,jewish,interest,notes
א,בוחר ראשון / בוחר שני,101 First Street,Y,,,,,
א,בוחר ראשון / בוחר שני,103 First Street,,,,,,
ב,בוחר שלישי / בוחר רביעי,"200 Second Street, Apt 2",,,,,,`;

check('parseCsv: basic rows + quoted field with comma', () => {
  const rows = parseCsv(sampleCsv);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].address, '101 First Street');
  assert.equal(rows[0].on_shliach_list, 'Y');
  assert.equal(rows[2].address, '200 Second Street, Apt 2');
  assert.equal(rows[2].chavrusa, 'ב');
});

check('slugify: stable, collides same as source', () => {
  assert.equal(slugify('101 First Street'), slugify(' 101   First Street '));
  assert.equal(slugify('200 Second Street, Apt 2'), '200-second-street-apt-2');
});

check('importWeek: creates addresses, builds routes, no visits yet', () => {
  const db = emptyDb();
  const rows = parseCsv(sampleCsv);
  importWeek(db, rows, '2026-09-05');
  assert.equal(db.addresses.length, 3);
  assert.equal(db.addresses[0].on_shliach_list, true);
  assert.equal(db.addresses[0].visits.length, 0);
  assert.deepEqual(Object.keys(db.currentWeek.routes).sort(), ['א', 'ב']);
  assert.equal(db.currentWeek.routes['א'].addressIds.length, 2);
});

check('importWeek: re-import updates metadata without duplicating addresses', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  importWeek(db, parseCsv(sampleCsv), '2026-09-12');
  assert.equal(db.addresses.length, 3);
  assert.equal(db.currentWeek.weekId, '2026-09-12');
});

check('recordVisit: appends a visit, marks entered, picks up route/bochurim', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  const id = slugify('101 First Street');
  recordVisit(db, id, { answered: true, jewish: true, interest: 'some', notes: 'follow up' });
  const addr = db.addresses.find((a) => a.id === id);
  assert.equal(addr.visits.length, 1);
  assert.equal(addr.visits[0].chavrusa, 'א');
  assert.equal(addr.visits[0].bochurim, undefined);
  assert.equal(db.weeks['2026-09-05']['א'], 'בוחר ראשון / בוחר שני');
  assert.equal(bochurimFor(db, addr.visits[0]), 'בוחר ראשון / בוחר שני');
  assert.equal(addr.visits[0].interest, 'some');
  assert.equal(db.currentWeek.entered[id], true);
});

check('recordVisit: saving twice in the same week updates in place, not a duplicate', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  const id = slugify('101 First Street');
  recordVisit(db, id, { answered: false, jewish: null, interest: null, notes: '' });
  recordVisit(db, id, { answered: true, jewish: true, interest: 'a_lot', notes: 'corrected' });
  const addr = db.addresses.find((a) => a.id === id);
  assert.equal(addr.visits.length, 1);
  assert.equal(addr.visits[0].answered, true);
  assert.equal(addr.visits[0].notes, 'corrected');
});

check('recordVisit: unknown address id throws', () => {
  const db = emptyDb();
  assert.throws(() => recordVisit(db, 'nope', {}));
});

check('addAddress: new address off-route, then recordVisit works on it', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  const addr = addAddress(db, '300 Third Street', { on_shliach_list: true, name_on_list: 'Family A' });
  assert.equal(db.addresses.length, 4);
  assert.equal(addr.on_shliach_list, true);
  assert.equal(addr.name_on_list, 'Family A');
  recordVisit(db, addr.id, { answered: true, jewish: true, interest: 'a_lot', notes: '' });
  assert.equal(db.addresses.find((a) => a.id === addr.id).visits.length, 1);
});

check('addAddress: existing address is returned, not duplicated', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  const before = db.addresses.length;
  const addr = addAddress(db, '  101 first street ');
  assert.equal(db.addresses.length, before);
  assert.equal(addr.address, '101 First Street');
});

check('addAddress: filing into a route appends it to that route once', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  addAddress(db, '300 Third Street', { chavrusa: 'א' });
  addAddress(db, '300 Third Street', { chavrusa: 'א' });
  assert.equal(db.currentWeek.routes['א'].addressIds.length, 3);
});

check('coverageStatus: never / fresh / stale / old', () => {
  const db = emptyDb();
  importWeek(db, parseCsv(sampleCsv), '2026-09-05');
  const id = slugify('101 First Street');
  const addr = db.addresses.find((a) => a.id === id);
  assert.equal(coverageStatus(addr), 'never');

  addr.visits.push({ date: '2026-09-01', week: 'w', chavrusa: '', bochurim: '', answered: null, jewish: null, interest: null, notes: '' });
  assert.equal(coverageStatus(addr), 'fresh');

  addr.visits[0].date = '2026-01-01';
  assert.equal(coverageStatus(addr), 'old');
});

check('bochurimFor falls back to a visit written before the per-week split', () => {
  const db = emptyDb();
  const legacy = { week: 'old', chavrusa: 'ג', bochurim: 'שם ישן' };
  assert.equal(bochurimFor(db, legacy), 'שם ישן');
  assert.equal(bochurimFor(db, null), '');
});

// Guards the storage decisions that keep this file readable and writable:
// GitHub serves a file this way up to 100 MB, and every save re-uploads the
// whole thing, so per-visit bloat is what actually hurts. A real week is ~900
// doors; this projects a worst-case year where every door is revisited weekly.
check('a year of weekly visits over ~900 doors stays well inside the limit', () => {
  const db = emptyDb();
  db.weeks = {};
  const rows = [];
  for (let i = 0; i < 900; i++) {
    rows.push({
      chavrusa: CHAVRUSA_CODES[i % 8],
      bochurim: 'בוחר ראשון / בוחר שני',
      address: `${100 + i} Example Street`,
      on_shliach_list: i % 20 === 0 ? 'Y' : '',
      name_on_list: '',
    });
  }
  importWeek(db, rows, '2026-01-01');
  for (let w = 0; w < 52; w++) {
    const week = `2026-w${w}`;
    db.weeks[week] = Object.fromEntries(CHAVRUSA_CODES.map((c) => [c, 'בוחר ראשון / בוחר שני']));
    for (const a of db.addresses) {
      a.visits.push({
        date: '2026-01-01',
        week,
        chavrusa: a.last_route,
        answered: true,
        jewish: false,
        interest: 'none',
        notes: '',
      });
    }
  }
  const mb = Buffer.byteLength(serializeDb(db), 'utf8') / 1024 / 1024;
  assert.ok(mb < 10, `a projected year serializes to ${mb.toFixed(1)} MB`);

  // The single largest past regression: copying the pair's names onto every
  // visit instead of recording them once per week.
  const sample = db.addresses[0].visits[0];
  assert.equal(sample.bochurim, undefined, 'visits must not carry bochurim');
});

console.log(`\n${passed} checks passed`);
