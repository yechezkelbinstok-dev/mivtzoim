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
  css/style.css
  js/github-api.js    GitHub REST calls + token storage
  js/vault.js         password-encrypted token vault
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

Everyday use is a single password. Open the site, type it, and you are in —
no username, no token, nothing else. The password is asked once per browser.

Behind that, a GitHub token still has to exist, because the private data repo
is reached through the GitHub API. It is created **once, ever**, by whoever
sets the site up:

1. First visit to a fresh site: the gate asks for a password and a token.
2. Create a fine-grained token at
   https://github.com/settings/personal-access-tokens/new with
   **Contents: Read and write** on `mivtzoim-data`, plus the same on this repo
   so the vault can be written once.
3. Enter it with the chosen password. The token is encrypted with that
   password (PBKDF2-SHA256, 600k iterations → AES-GCM) and published as
   `docs/vault.json`.

After that nobody handles a token again. Everyone else — and the same person
on any other machine — types the password only; the page fetches `vault.json`,
decrypts the token, and keeps it in that browser.

To change the password or rotate the token, delete `docs/vault.json` and the
gate returns to setup.

### What this protects against, and what it does not

`docs/vault.json` is public, and the password is short. The encryption slows
an attacker down; it does not stop one. Anyone who finds this repository can
take `vault.json` and try candidate passwords offline until the token falls
out, and a short numeric password does not survive that for long. The token
they recover reads and writes every address, name, and note in
`mivtzoim-data`.

This is a deliberate tradeoff, chosen knowingly in favour of a login the
non-technical user will actually use. It is written down so that whoever reads
this later knows exactly what the password is and is not doing. Real protection
needs the password checked somewhere the public cannot read — a small
server-side function holding the token, or a backend service with its own
accounts.

If the token is ever exposed, revoke it on GitHub, delete `docs/vault.json`,
and run setup again with a new token.

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
node tests/entry.browser.mjs  # 64 checks: the real pages against a stubbed API
```

The browser test needs `playwright` available; it serves `docs/`, stubs every
`api.github.com` call, and drives the real pages.
