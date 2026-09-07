// Address/visit data model, CSV import, and derived-status helpers.
// Kept framework-free so it can be unit-checked directly (see js/data.test.js).

export const CHAVRUSA_CODES = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ז', 'ח'];

export function slugify(address) {
  return String(address)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function truthy(v) {
  if (v == null) return false;
  const s = String(v).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === 'TRUE' || s === '1';
}

// Minimal CSV parser: handles quoted fields and commas/newlines inside quotes.
// Expects a header row. Returns array of row objects keyed by header.
export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  while (i < clean.length) {
    const c = clean[i];
    if (inQuotes) {
      if (c === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      pushField();
      i++;
      continue;
    }
    if (c === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) pushRow();
  const nonEmpty = rows.filter((r) => r.some((f) => f.trim() !== ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0].map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => (obj[h] = (r[idx] ?? '').trim()));
    return obj;
  });
}

// Builds a currentWeek block + upserts address metadata (list membership)
// from parsed door_log.csv rows. Does NOT touch visit history — results are
// only appended when someone actually enters them via recordVisit().
export function importWeek(db, rows, weekId) {
  const routes = {};
  const addressIds = [];
  for (const r of rows) {
    const address = (r.address || '').trim();
    if (!address) continue;
    const id = slugify(address);
    const chavrusa = (r.chavrusa || '').trim();
    const bochurim = (r.bochurim || '').trim();

    let existing = db.addresses.find((a) => a.id === id);
    if (!existing) {
      existing = {
        id,
        address,
        on_shliach_list: truthy(r.on_shliach_list),
        name_on_list: (r.name_on_list || '').trim(),
        last_route: chavrusa,
        visits: [],
      };
      db.addresses.push(existing);
    } else {
      if (truthy(r.on_shliach_list)) existing.on_shliach_list = true;
      if ((r.name_on_list || '').trim()) existing.name_on_list = r.name_on_list.trim();
      if (chavrusa) existing.last_route = chavrusa;
    }

    if (chavrusa) {
      if (!routes[chavrusa]) routes[chavrusa] = { bochurim, addressIds: [] };
      routes[chavrusa].addressIds.push(id);
    }
    addressIds.push(id);
  }
  db.currentWeek = {
    weekId,
    importedAt: new Date().toISOString(),
    routes,
    entered: {},
  };

  // The pair's names are recorded once for the week rather than copied onto
  // every visit. At ~900 doors a week the duplication was the single largest
  // thing in the file.
  if (!db.weeks) db.weeks = {};
  db.weeks[weekId] = Object.fromEntries(
    Object.keys(routes).map((code) => [code, routes[code].bochurim || ''])
  );
  return db;
}

// The pair who walked a given visit. Reads the per-week record, falling back
// to a bochurim field on the visit itself for data written before the split.
export function bochurimFor(db, visit) {
  if (!visit) return '';
  const week = db.weeks && db.weeks[visit.week];
  if (week && week[visit.chavrusa]) return week[visit.chavrusa];
  return visit.bochurim || '';
}

// Adds an address that wasn't on the printed route (a shliach's-list entry,
// or a door that turned out to matter). Returns the existing record if the
// address is already known. `chavrusa` optionally files it into a route of
// the current week.
export function addAddress(db, address, { chavrusa = '', on_shliach_list = false, name_on_list = '' } = {}) {
  const text = String(address).trim();
  if (!text) throw new Error('empty address');
  const id = slugify(text);
  let addr = db.addresses.find((a) => a.id === id);
  if (!addr) {
    addr = {
      id,
      address: text,
      on_shliach_list: !!on_shliach_list,
      name_on_list: name_on_list || '',
      last_route: chavrusa,
      visits: [],
    };
    db.addresses.push(addr);
  }
  const week = db.currentWeek;
  if (week && chavrusa) {
    if (!week.routes[chavrusa]) week.routes[chavrusa] = { bochurim: '', addressIds: [] };
    if (!week.routes[chavrusa].addressIds.includes(id)) {
      week.routes[chavrusa].addressIds.push(id);
    }
    addr.last_route = chavrusa;
  }
  return addr;
}

// Appends/updates this week's visit result for one address and marks it
// entered in currentWeek. `result` = { answered, jewish, interest, notes }
// with answered/jewish as true/false/null and interest as
// 'none'|'some'|'a_lot'|null.
export function recordVisit(db, addressId, result) {
  const addr = db.addresses.find((a) => a.id === addressId);
  if (!addr) throw new Error(`unknown address id: ${addressId}`);
  const week = db.currentWeek;
  const weekId = week ? week.weekId : new Date().toISOString().slice(0, 10);
  const chavrusa = week ? findRouteFor(week, addressId) : null;

  const existing = addr.visits.find((v) => v.week === weekId);
  const visit = {
    date: new Date().toISOString().slice(0, 10),
    week: weekId,
    chavrusa: chavrusa || (existing && existing.chavrusa) || '',
    answered: result.answered ?? null,
    jewish: result.jewish ?? null,
    interest: result.interest ?? null,
    notes: result.notes || '',
  };
  if (existing) {
    Object.assign(existing, visit);
  } else {
    addr.visits.push(visit);
  }
  if (week) week.entered[addressId] = true;
  return addr;
}

function findRouteFor(week, addressId) {
  for (const code of Object.keys(week.routes || {})) {
    if (week.routes[code].addressIds.includes(addressId)) return code;
  }
  return null;
}

export function latestVisit(addr) {
  if (!addr.visits.length) return null;
  return addr.visits.reduce((a, b) => (a.date > b.date ? a : b));
}

export function daysSince(dateStr) {
  const then = new Date(dateStr + 'T00:00:00');
  const now = new Date();
  return Math.floor((now - then) / 86400000);
}

// 'never' | 'fresh' | 'stale' | 'old'
export function coverageStatus(addr) {
  const v = latestVisit(addr);
  if (!v) return 'never';
  const d = daysSince(v.date);
  if (d <= 60) return 'fresh';
  if (d <= 180) return 'stale';
  return 'old';
}
