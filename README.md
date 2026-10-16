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
  index.html          entry: walk the week's routes, record results per door
  dashboard.html      what is worth carrying forward, plus past weeks folded away
  map.html            the shliach's list, coloured by what entry has established
  vendor/leaflet/     Leaflet 1.9.4, self-hosted rather than pulled from a CDN
  favicon.png         tefillin; apple-touch-icon.png is the same at 180px
  css/style.css
  js/github-api.js    GitHub REST calls + token storage
  js/vault.js         browser-local encrypted token vault
  js/i18n.js          Hebrew/English strings and direction
  js/data.js          address/visit model, CSV import, address keys
  js/store.js         in-memory db + serialized write queue
  js/auth.js          password gate
  js/entry.js         entry page
  js/dashboard.js     dashboard page
  js/map.js           map page
tests/                node checks; no build step, no dependencies to install
```

## Hosting

GitHub Pages, from `main`, `/docs`. Settings → Pages → Source: *Deploy from a
branch* → Branch `main`, folder `/docs`.

## Access

Each browser needs its own initial setup. Create a fine-grained token at
https://github.com/settings/personal-access-tokens/new with **Contents: Read
and write** on **only `mivtzoim-data`**, then enter it with a password. No
permission on this public site repository is needed.

The encrypted vault stays in that browser's `localStorage` (PBKDF2-SHA256,
600,000 iterations, AES-GCM). Setup never reads or writes `docs/vault.json`.
After sign-in, the active token is also cached in that browser, as before.
Signing out removes the active token and cached data; the local vault allows
password sign-in again in the same browser. A different browser needs a token
and password of its own.

To reset this browser's setup, sign out and remove `mivtzoim_local_vault`
from this site's local storage. To rotate a token, revoke it on GitHub and
repeat setup in each browser that used it.

### Previous public vault exposure

`docs/vault.json` was previously committed publicly. Its metadata records
600,000 iterations; the previous README describes a short password. The old
implementation permits offline password guessing. Documentation describes
the token as having read/write access to private `mivtzoim-data`; its current
validity and actual permissions have not been verified. There is no evidence
from this review that anyone recovered or misused it.

The file is removed from the current branches and ignored by Git. Setup now
keeps the vault local so it cannot republish the file. **Revoke the token
previously stored in the public vault.** Deleting the file does not revoke it
or erase copies in Git history, caches, forks, or prior downloads. Do not
reuse that token or publish a replacement vault.

The local password is not an access-control boundary against someone with
access to the browser or its storage: the active token is still cached there.

## Data

One file, `db.json`, in `mivtzoim-data`:

```jsonc
{
  "version": 1,
  "addresses": [
    {
      "id": "101-first-street",       // slug of the address, the stable key
      "address": "101 First Street",
      "on_shliach_list": true,        // historical list entry vs. cold door
      "name_on_list": "Mr. & Mrs. A", // the household, where it is known
      "zip": "45208",                 // both only present for list entries
      "hood": "Hyde Park / Mt Lookout",
      "last_route": "\u05d0",
      "visits": [
        {
          "date": "2026-09-07",
          "week": "2026-09-07",
          "chavrusa": "\u05d0",
          "still_there": null,        // list doors: true|false|"no_answer"|null
          "answered": true,           // cold doors only: true | false | null
          "jewish": true,             // cold doors only: true | false | null
          "interest": "some",         // cold doors only: none|some|a_lot|null
          "notes": ""
        }
      ]
    }
  ],
  "weeks": {                          // the pair per route, once per week
    "2026-09-07": { "\u05d0": "\u05e9\u05dd / \u05e9\u05dd" }
  },
  "currentWeek": {                    // the route sheet being entered
    "weekId": "2026-09-07",
    "routes": { "\u05d0": { "bochurim": "", "addressIds": ["101-first-street"] } },
    "entered": { "101-first-street": true }
  }
}
```

Shliach's-list entries carry `lat`/`lon`, which is what the map draws. Nothing
is geocoded here — the coordinates come in with the list. Doors picked up by
walking a route have none, and are not on the map.

### On the list is not the same as done

A door being on the shliach's list says nothing about whether anyone has been
there. It counts as done only once a visit has been entered against it, and
then what matters is what the entry said. The map colours exactly that:

| | |
|---|---|
| grey | on the list, nothing entered yet |
| green | entered — still there |
| red | entered — not there |
| blue | entered — nobody answered |
| amber | entered, but the question was left blank |

### Past weeks

A week's route sheet is not kept — it is a scratch list, and the current one is
replaced when the next is loaded. What survives is the visits, each carrying
the week and chavrusa it was walked under, and the board reconstructs earlier
weeks from those. It is folded away at the bottom, since it is history rather
than something to act on.

### Two kinds of door

The printed door-by-door sheet treats a shliach's-list address as a different
row, not a normal row with a mark on it: bold, the family name beneath, and the
result columns replaced outright. The site follows that.

- **Cold door** — ענו / לא ענו, יהודי / לא יהודי, בכלל לא / קצת / הרבה, notes.
- **Shliach's-list door** — עדיין שם? כן / לא / לא ענו, then notes. The other
  three are hidden and written as null. For a list built up over decades the
  question that matters is whether the household is still at the address, and
  nobody coming to the door answers neither way — it is its own value,
  `"no_answer"`, distinct from leaving the question blank. Visits written
  before it existed hold `true`/`false`/`null` and still read correctly.

Each is stored per visit, so a household can be recorded as gone this year
having been there last year.

### Finding one door in the middle of a list

Search pulls a door out of whatever order it belongs to, which is exactly what
is wanted for finding it and exactly wrong for carrying on afterwards. So while
a search is in play a third column appears on the far side of the card, opposite
the search: the list that door sits on — this week's route if it is on one,
otherwise the shliach's list in the list's own order — with its position in it,
its neighbours either side, and ▲ / ▼ to step through them. Skipping and saving
follow that list too, not the search results.

### Getting data in

There is no import UI. Weeks and list updates are loaded into `mivtzoim-data`
directly, outside the site, so nobody using it has to find a file.

A week comes from the paper-packet generator's `door_log.csv`:
`chavrusa,bochurim,address,on_shliach_list,name_on_list,answered,jewish,interest,notes`.
A UTF-8 BOM on the header row is handled.

`address` is the identity of a door across weeks. Trailing street-type
abbreviations are folded (`Ave.` and `Avenue` are one door, as are `Rd`/`Road`,
`Ln`/`Lane`, `Pl`/`Place`), because the generator and the shliach's list spell
them inconsistently and each spelling would otherwise become its own record and
split that address's history.

### Size

A week is roughly 900 doors and every save re-uploads the whole file, so the
per-visit cost is what matters. Measured against real data:

| | size |
|---|---|
| 1,164 addresses, none entered | 191 KB |
| a week of results entered | ~265 KB |
| projected after a year of weekly revisits | ~5 MB |

Two decisions keep it there, and `tests/data.test.mjs` fails if either
regresses:

- **The pair's names are stored once per week**, in `weeks`, not copied onto
  each of ~900 visits. This was the single largest thing in the file.
- **The stored JSON is not pretty-printed.** Indentation was about a third of
  the bytes.

Reads use the contents API, which caps at 1 MB. At the rate above that is
roughly a year of entry. When it approaches, split visits into per-week files
and leave the addresses as an index — and verify the new read path against the
live API before it goes anywhere near the branch being served.

Writes are serialized, one at a time, and carry the file's SHA. If the other
person saved in between, the page refetches their copy and replays its own
unsaved operations onto it rather than overwriting. Saves are debounced, so a
burst of entry becomes a handful of requests rather than one per door; pending
work flushes when the tab is hidden, and closing with unsaved changes warns.

A read that does not succeed is never rendered as an empty database — only a
404 means "no file yet". Everything else surfaces as an error.

## Tests

```
node tests/data.test.mjs      # 16 checks: model, CSV import, address keys, size
node tests/entry.browser.mjs  # real pages against a stubbed API
```

The browser test needs `playwright` available; it serves `docs/`, stubs every
`api.github.com` call, and drives the real pages.

**Live application API calls remain untested.** Every GitHub call in the
browser suite is stubbed; these checks do not verify actual token permissions
or real reads/writes to `mivtzoim-data`.
