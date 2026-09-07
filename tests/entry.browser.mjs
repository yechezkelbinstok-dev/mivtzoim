// End-to-end check of the entry flow against a stubbed GitHub API.
// Requires playwright to be available; run with:
//   node tests/entry.browser.mjs
//
// Serves docs/ over http (ES modules need a real origin), stubs every
// api.github.com call with an in-memory file, and drives the real UI.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let vaultStore = null; // stands in for docs/vault.json once setup publishes it

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/vault.json') {
    if (!vaultStore) {
      res.writeHead(404).end('no vault');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(vaultStore);
    return;
  }
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404).end('nope');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'text/plain' });
  res.end(fs.readFileSync(file));
});

const CSV = `chavrusa,bochurim,address,on_shliach_list,name_on_list,answered,jewish,interest,notes
א,בוחר ראשון / בוחר שני,101 First Street,Y,משפחה א,,,,
א,בוחר ראשון / בוחר שני,103 First Street,,,,,,
א,בוחר ראשון / בוחר שני,105 First Street,,,,,,
ב,בוחר שלישי / בוחר רביעי,200 Second Street,,,,,,
ב,בוחר שלישי / בוחר רביעי,202 Second Street,,,,,,`;

let passed = 0;
const check = (name) => {
  passed++;
  console.log(`ok - ${name}`);
};

// Saves are debounced, so the indicator can still read "saved" from the
// previous write. Wait for the write itself to land.
async function waitForPut(count, label) {
  const deadline = Date.now() + 15000;
  while (puts.length < count) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for PUT: ${label}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ locale: 'he-IL' });

// ---- stubbed GitHub ----
let stored = null; // { content: <utf8 string>, sha }
let readFailure = 0; // when set, the db read returns this status
let shaN = 0;
const puts = [];

await ctx.route('https://fonts.googleapis.com/**', (r) => r.abort());
await ctx.route('https://fonts.gstatic.com/**', (r) => r.abort());

await ctx.route('https://api.github.com/**', async (route) => {
  const req = route.request();
  const url = req.url();
  const json = (status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.endsWith('/repos/yechezkelbinstok-dev/mivtzoim-data')) {
    const auth = req.headers()['authorization'] || '';
    if (!auth.includes('good-token')) return json(401, { message: 'Bad credentials' });
    return json(200, { full_name: 'yechezkelbinstok-dev/mivtzoim-data', private: true });
  }

  if (url.includes('/mivtzoim/contents/docs/vault.json')) {
    if (req.method() === 'GET') return json(404, { message: 'Not Found' });
    const body = JSON.parse(req.postData());
    vaultStore = Buffer.from(body.content, 'base64').toString('utf8');
    return json(200, { content: { sha: 'vault1' } });
  }

  if (url.includes('/contents/db.json')) {
    if (req.method() === 'GET') {
      if (readFailure) return json(readFailure, { message: 'boom' });
      if (!stored) return json(404, { message: 'Not Found' });
      return json(200, {
        content: Buffer.from(stored.content, 'utf8').toString('base64'),
        sha: stored.sha,
      });
    }
    if (req.method() === 'PUT') {
      const body = JSON.parse(req.postData());
      const content = Buffer.from(body.content, 'base64').toString('utf8');
      if (stored && body.sha !== stored.sha) return json(409, { message: 'conflict' });
      stored = { content, sha: `sha${++shaN}` };
      puts.push({ message: body.message, data: JSON.parse(content) });
      return json(200, { content: { sha: stored.sha } });
    }
  }
  return json(404, { message: 'unstubbed: ' + url });
});

const page = await ctx.newPage();
const errors = [];
// Uncaught exceptions and app-level console errors only. Failed *resource*
// loads are expected here: fonts are aborted, the bad-token step is a real
// 401, and the first db.json fetch is a real 404.
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (m.text().startsWith('Failed to load resource')) return;
  errors.push(m.text());
});

// ---- 1. first-run setup, then password-only login ----
const PASSWORD = 'test-password'; // fixture only — never the real site password

await page.goto(base + '/index.html');
await page.waitForSelector('#gateOverlay:not([hidden])');
check('the gate blocks the page before anyone is signed in');

await page.waitForSelector('#setupRow:not([hidden])');
check('first run asks for a token once, since no vault exists yet');

await page.fill('#pwInput', PASSWORD);
await page.fill('#setupToken', 'bad-token');
await page.click('#gateOk');
await page.waitForFunction(
  () => document.getElementById('gateStatus').textContent.trim() === 'טוקן לא תקין'
);
check('setup rejects a token that cannot reach the data repo');

await page.fill('#setupToken', 'good-token');
await page.click('#gateOk');
await page.waitForSelector('#gateOverlay[hidden]', { state: 'attached' });
check('setup succeeds and lets the page through');

assert.ok(vaultStore, 'vault.json was published');
const vaultJson = JSON.parse(vaultStore);
assert.ok(vaultJson.ct && vaultJson.salt && vaultJson.iv, 'vault carries ciphertext');
assert.ok(!vaultStore.includes('good-token'), 'the token is not stored in the clear');
check('the token is published encrypted, never in plaintext');

// ---- 2. import ----
await page.click('#importBtn');
await page.fill('#csvText', CSV);
await page.click('#importDo');
await page.waitForSelector('#importOverlay[hidden]', { state: 'attached' });
await page.waitForFunction(() => document.querySelectorAll('.route-chip').length === 2);
check('import builds one chip per chavrusa');

const chipText = await page.$$eval('.route-chip', (els) => els.map((e) => e.textContent.trim()));
assert.deepEqual(chipText, ['א0/3', 'ב0/2']);
check('chips show entered/total in arabic numerals');

await page.waitForFunction(() => document.querySelectorAll('.addr-list .addr-row').length === 3);
const first = await page.textContent('.addr-row[aria-current="true"] .addr');
assert.equal(first.trim(), '101 First Street');
check('first address of the route is auto-selected');

assert.equal((await page.textContent('#cardAddr')).trim(), '101 First Street');
const meta = await page.textContent('#cardMeta');
assert.ok(meta.includes('מסלול א'), 'route pill');
assert.ok(meta.includes('בוחר ראשון'), 'bochurim');
assert.equal((await page.textContent('#cardName')).trim(), 'משפחה א');
check('card shows address, route, bochurim, and the list name');

// ---- 2b. shliach's-list doors read differently, as they do on paper ----
const listRow = '.addr-row[data-id="101-first-street"]';
assert.equal(await page.getAttribute(listRow, 'data-onlist'), 'true');
assert.equal(
  await page.$eval(listRow + ' .listname', (e) => e.textContent.trim()),
  'משפחה א',
  'the family name sits under the address, as on the sheet'
);
assert.equal(
  await page.$eval('.addr-row[data-id="103-first-street"]', (e) => e.dataset.onlist),
  'false'
);
assert.equal(await page.$$eval('.addr-row[data-id="103-first-street"] .listname', (e) => e.length), 0);
check('list entries are marked and named; cold doors are not');

const weightList = await page.$eval(listRow + ' .addr', (e) => getComputedStyle(e).fontWeight);
const weightCold = await page.$eval('.addr-row[data-id="103-first-street"] .addr', (e) => getComputedStyle(e).fontWeight);
assert.ok(Number(weightList) > Number(weightCold), `list ${weightList} vs cold ${weightCold}`);
check('the list address is actually rendered bolder, not just tagged');

await page.click('#kindFilter button[data-kind="list"]');
await page.waitForFunction(() => document.querySelectorAll('.addr-list .addr-row').length === 1);
assert.equal((await page.textContent('.addr-row .addr')).trim(), '101 First Street');
check('filtering to ★ list shows only the shliach\'s-list doors');

await page.click('#kindFilter button[data-kind="cold"]');
await page.waitForFunction(() => document.querySelectorAll('.addr-list .addr-row').length === 2);
check('filtering to new doors excludes the list entries');

await page.click('#kindFilter button[data-kind=""]');
await page.waitForFunction(() => document.querySelectorAll('.addr-list .addr-row').length === 3);
check('clearing the filter restores the whole route');

// ---- 3. entering a result ----
await page.click('#fAnswered .choice[data-value="true"]');
await page.click('#fJewish .choice[data-value="true"]');
await page.click('#fInterest .choice[data-value="some"]');
await page.fill('#fNotes', 'לחזור בערב');
const putsBeforeSave = puts.length;
await page.click('#saveBtn');
await waitForPut(putsBeforeSave + 1, 'first visit');
await page.waitForFunction(() => document.getElementById('saveText').textContent === 'נשמר');
check('save reaches the api and the indicator settles on saved');

const lastPut = puts[puts.length - 1];
const savedAddr = lastPut.data.addresses.find((a) => a.address === '101 First Street');
assert.equal(savedAddr.visits.length, 1);
assert.equal(savedAddr.visits[0].answered, true);
assert.equal(savedAddr.visits[0].jewish, true);
assert.equal(savedAddr.visits[0].interest, 'some');
assert.equal(savedAddr.visits[0].notes, 'לחזור בערב');
assert.equal(savedAddr.visits[0].chavrusa, 'א');
assert.equal(savedAddr.visits[0].bochurim, undefined, 'bochurim is not copied onto every visit');
assert.equal(lastPut.data.weeks[lastPut.data.currentWeek.weekId]['א'], 'בוחר ראשון / בוחר שני');
check('the payload carries the result and route; the pair is recorded once per week');

const cur = await page.textContent('.addr-row[aria-current="true"] .addr');
assert.equal(cur.trim(), '103 First Street');
check('saving advances to the next address in route order');

const chipAfter = await page.textContent('.route-chip[aria-pressed="true"]');
assert.ok(chipAfter.includes('1/3'), `expected 1/3, got ${chipAfter}`);
check('route progress counter advances');

const emptyDraft = await page.$$eval('#fAnswered .choice', (els) =>
  els.map((e) => e.getAttribute('aria-pressed'))
);
assert.deepEqual(emptyDraft, ['false', 'false']);
assert.equal(await page.inputValue('#fNotes'), '');
check('the next address starts with a blank form');

// ---- 4. correcting an already-entered address ----
await page.click('.addr-row[data-id="101-first-street"]');
assert.equal(await page.getAttribute('#fAnswered .choice[data-value="true"]', 'aria-pressed'), 'true');
assert.equal(await page.inputValue('#fNotes'), 'לחזור בערב');
check('re-opening an entered address shows what was entered');

await page.click('#fInterest .choice[data-value="a_lot"]');
const putsBeforeCorrection = puts.length;
await page.click('#saveBtn');
await waitForPut(putsBeforeCorrection + 1, 'correction');
const corrected = puts[puts.length - 1].data.addresses.find(
  (a) => a.address === '101 First Street'
);
assert.equal(corrected.visits.length, 1, 'still one visit for the week, not a duplicate');
assert.equal(corrected.visits[0].interest, 'a_lot');
check('correcting updates the same visit instead of duplicating it');

// the save indicator is already showing a value here, so it catches a
// language switch that only repaints on the next state change
await page.click('#langBtn');
await page.waitForFunction(() => document.documentElement.dir === 'ltr');
assert.equal(await page.textContent('#saveText'), 'Saved');
check('save indicator re-renders into the new language');
await page.click('#langBtn');
await page.waitForFunction(() => document.documentElement.dir === 'rtl');

// ---- 5. off-route address ----
await page.fill('#search', '300 Third Street');
await page.waitForSelector('#addRow');
await page.click('#addRow');
await page.waitForFunction(
  () => document.getElementById('cardAddr').textContent.trim() === '300 Third Street'
);
await page.click('#fAnswered .choice[data-value="false"]');
const putsBeforeAdd = puts.length;
await page.click('#saveBtn');
await waitForPut(putsBeforeAdd + 1, 'off-route address');
const added = puts[puts.length - 1].data.addresses.find((a) => a.address === '300 Third Street');
assert.ok(added, 'the new address was written');
assert.equal(added.visits[0].answered, false);
check('an address not on the printed route can be added and entered');

// ---- 6. persistence across a reload ----
await page.waitForFunction(() => document.getElementById('saveText').textContent === 'נשמר');
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.route-chip').length === 2);
const chipsReload = await page.$$eval('.route-chip', (els) => els.map((e) => e.textContent.trim()));
assert.ok(chipsReload[0].includes('2/4'), `expected route א at 2/4, got ${chipsReload[0]}`);
check('progress survives a reload (read back from the api, not memory)');

const entered = await page.$$eval('.addr-row[data-entered="true"] .addr', (els) =>
  els.map((e) => e.textContent.trim())
);
assert.ok(entered.includes('101 First Street'));
check('entered addresses stay marked after reload');

// ---- 6b. the co-runner's path: password only, no token anywhere ----
await page.click('#gateBtn');
await page.waitForSelector('#gateOverlay:not([hidden])');
await page.click('#gateOut'); // sign out, dropping the stored token
await page.reload();
await page.waitForSelector('#gateOverlay:not([hidden])');
assert.equal(await page.isHidden('#setupRow'), true, 'no token field once a vault exists');
check('with a vault published, the gate asks for the password only');

await page.fill('#pwInput', '11111');
await page.click('#gateOk');
await page.waitForFunction(
  () => document.getElementById('gateStatus').textContent.trim() === 'סיסמה שגויה'
);
check('a wrong password is refused');

await page.fill('#pwInput', PASSWORD);
await page.click('#gateOk');
await page.waitForSelector('#gateOverlay[hidden]', { state: 'attached' });
await page.waitForFunction(() => document.querySelectorAll('.route-chip').length === 2);
check('the right password decrypts the token and opens the week');

await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.route-chip').length === 2);
assert.equal(await page.isHidden('#gateOverlay'), true);
check('the password is asked once per machine, not every visit');

// ---- 6c. a failed read must never look like an empty database ----
readFailure = 500;
await page.reload();
await page.waitForFunction(
  () => document.getElementById('saveState').dataset.state === 'error',
  { timeout: 15000 }
);
assert.equal(await page.isHidden('#workCard'), true, 'no entry card on a failed read');
const chipsOnFailure = await page.$$eval('.route-chip', (els) => els.length);
assert.equal(chipsOnFailure, 0, 'must not render an empty week');
check('a failed read shows an error rather than an empty database');

readFailure = 0;
await page.reload();
await page.waitForFunction(() => document.querySelectorAll('.route-chip').length === 2);
check('recovering from the failure restores the real data');

// ---- 7. dashboard ----
await page.goto(base + '/dashboard.html');
await page.waitForFunction(() => document.querySelectorAll('#rows tr').length > 0);
const rowCount = await page.$$eval('#rows tr', (els) => els.length);
assert.equal(rowCount, 6, 'five imported + one added');
check('dashboard lists every address ever recorded');

const tiles = await page.$$eval('.tile', (els) =>
  els.map((e) => ({ num: e.querySelector('.num').textContent, cap: e.querySelector('.cap').textContent }))
);
assert.equal(tiles[0].num, '6');
assert.equal(tiles.find((t) => t.cap === 'טרם ביקרו').num, '4');
assert.equal(tiles.find((t) => t.cap === '★ רשימה').num, '1');
check('dashboard tiles count addresses, coverage and list membership');

await page.selectOption('#fCoverage', 'never');
await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 4);
check('coverage filter narrows the table');

await page.selectOption('#fCoverage', '');
await page.fill('#search', 'first');
await page.waitForFunction(() => document.querySelectorAll('#rows tr').length === 3);
check('address search filters the table');

// ---- 8. language ----
await page.fill('#search', '');
await page.click('#langBtn');
await page.waitForFunction(() => document.documentElement.dir === 'ltr');
assert.equal(await page.getAttribute('html', 'lang'), 'en');
check('language toggle switches the document to english and ltr');

const enTiles = await page.$$eval('.tile .cap', (els) => els.map((e) => e.textContent));
assert.ok(
  enTiles.includes('Never visited'),
  `expected a "Never visited" tile, got ${enTiles.join(', ')}`
);
const enHeaders = await page.$$eval('thead th', (els) => els.map((e) => e.textContent));
assert.ok(enHeaders.includes('Address'), `expected Address header, got ${enHeaders.join(', ')}`);
assert.ok(enHeaders.includes('Coverage'));
check('tiles and table headers follow the language');

const enCoverage = await page.$$eval('#fCoverage option', (els) => els.map((e) => e.textContent));
assert.ok(enCoverage.includes('Under 2 months') && enCoverage.includes('Never visited'));
check('filter dropdowns follow the language');

const addrCell = await page.textContent('#rows tr:first-child td:first-child');
assert.ok(/[A-Za-z]/.test(addrCell) && !/[֐-׿]/.test(addrCell), addrCell);
check('addresses stay english in both languages');

await page.reload();
await page.waitForFunction(() => document.querySelectorAll('#rows tr').length > 0);
assert.equal(await page.getAttribute('html', 'dir'), 'ltr');
check('language choice survives a reload');

await page.click('#langBtn');
await page.waitForFunction(() => document.documentElement.dir === 'rtl');
const heTiles = await page.$$eval('.tile .cap', (els) => els.map((e) => e.textContent));
assert.ok(heTiles.includes('טרם ביקרו'));
check('toggling back returns to hebrew');

// ---- 8. a board with nothing imported ----
readFailure = 0;
stored = null; // as if nothing had ever been imported
await page.goto(base + '/dashboard.html');
await page.waitForSelector('#boardEmpty:not([hidden])');
assert.equal(await page.isHidden('.table-wrap'), true, 'no empty table');
assert.equal(await page.isHidden('.tiles'), true, 'no row of zeroes');
check('an empty board offers the import instead of a table of zeroes');

assert.deepEqual(errors, [], `page errors: ${errors.join(' | ')}`);
check('no page errors anywhere in the flow');

await browser.close();
server.close();
console.log(`\n${passed} checks passed`);
