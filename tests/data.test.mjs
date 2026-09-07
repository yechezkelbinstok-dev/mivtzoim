// Plain-node sanity checks for docs/js/data.js — run with:
//   node tests/data.test.mjs
// No test framework dependency on purpose (keeps the site build-free).

import assert from 'node:assert/strict';
import {
  parseCsv,
  importWeek,
  recordVisit,
  addAddress,
  slugify,
  latestVisit,
  daysSince,
  coverageStatus,
} from '../docs/js/data.js';

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
  assert.equal(addr.visits[0].bochurim, 'בוחר ראשון / בוחר שני');
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

console.log(`\n${passed} checks passed`);
