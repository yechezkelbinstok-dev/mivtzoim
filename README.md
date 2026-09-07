# mivtzoim

Static site for tracking mivtzoim visits: weekly route entry and an ongoing
record of every address ever visited.

**This repository contains code only.** No addresses, names, or visit data —
not in the working tree, not in the history. All data lives in the private
`mivtzoim-data` repository and is read and written at runtime from the
browser via the GitHub REST API.

## Layout

```
docs/                 the site (GitHub Pages serves this directory)
  index.html          entry: import a week's routes, walk them, record results
  dashboard.html      every address ever recorded, coverage and last result
  css/style.css
  js/github-api.js    GitHub REST calls + token storage
  js/data.js          address/visit model, CSV import, coverage rules
  js/store.js         in-memory db + serialized write queue
  js/auth.js          token gate
  js/entry.js         entry page
  js/dashboard.js     dashboard page
tests/                node checks; no build step, no dependencies to install
```

## Hosting

GitHub Pages, from `main`, `/docs`. Settings → Pages → Source: *Deploy from a
branch* → Branch `main`, folder `/docs`.

## Access

The site holds no credentials. Each person pastes a GitHub personal access
token into the page once; it is kept in that browser's `localStorage` and is
sent only to `api.github.com`. It is never committed, never hardcoded, and
never sent anywhere else.

The token needs read and write access to **contents** of the private
`mivtzoim-data` repository (a fine-grained token scoped to just that
repository is enough).

## Data

One file, `db.json`, in `mivtzoim-data`:

```jsonc
{
  "version": 1,
  "addresses": [
    {
      "id": "101-first-street",       // slug of the address, stable key
      "address": "101 First Street",
      "on_shliach_list": true,        // historical list entry vs. cold door
      "name_on_list": "",
      "last_route": "א",
      "visits": [
        {
          "date": "2026-09-07",
          "week": "2026-09-07",
          "chavrusa": "א",
          "bochurim": "",
          "answered": true,           // true | false | null
          "jewish": true,             // true | false | null
          "interest": "some",         // "none" | "some" | "a_lot" | null
          "notes": ""
        }
      ]
    }
  ],
  "currentWeek": {                    // the imported route sheet in progress
    "weekId": "2026-09-07",
    "importedAt": "2026-09-07T12:00:00.000Z",
    "routes": { "א": { "bochurim": "", "addressIds": ["101-first-street"] } },
    "entered": { "101-first-street": true }
  }
}
```

Writes are serialized, one request at a time, and carry the file's SHA. If the
other person saved in between, the page refetches their copy and replays its
own unsaved operations onto it rather than overwriting.

Import expects the columns produced by the paper-packet generator's
`door_log.csv`: `chavrusa,bochurim,address,on_shliach_list,name_on_list,answered,jewish,interest,notes`.

## Tests

```
node tests/data.test.mjs      # data model, CSV import, coverage rules
node tests/entry.browser.mjs  # full entry flow in a browser, stubbed API
```

The browser test needs `playwright` available; it serves `docs/`, stubs every
`api.github.com` call, and drives the real pages.
