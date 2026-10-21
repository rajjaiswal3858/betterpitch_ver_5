# Artisan replica (https://better-pitch-ver-2-mu.vercel.app/)

An exact, working local copy of https://www.artisan.co built by recording what
the real site loads in Chrome and replaying it with the original URLs, so the
Next.js JavaScript, animations, menus and images all work.

## Run

    npm install      # first time only
    npm start        # -> http://localhost:5000

## Commands

| Command | What it does |
|---|---|
| `npm start` | Serves the archive at http://localhost:5000 (`PORT=6000 npm start` to change port) |
| `npm run capture` | Re-records every page in `pages.txt` from the live site (needs internet) |
| `npm run capture -- /pricing /about` | Re-records only specific pages |
| `npm run verify` | Opens every page from the local copy, lists missing files/JS errors, saves screenshots to `screenshots/` |
| `npm run compare` | Screenshots live site vs local copy at 1440 / 768 / 375px, segment by segment down each page, and reports % of pixels that differ (`comparisons/`, `comparisons/report.json`) |
| `npm run recolor` | Recolours purple in the archived images to the BetterPitch palette (`betterpitch/recolored/`); re-run after a capture, then restart the server |
| `npm run fetch-missing` | Downloads files `verify` reported missing (reads `verify-report.txt`) straight into the archive |

After a capture, restart `npm start` so it picks up the new archive.
To add a page (e.g. a blog post), add its path to `pages.txt` and run capture.

Chrome is expected at the default install path; to use Edge (or another
Chromium) set `CHROME_PATH`, e.g. in PowerShell:
`$env:CHROME_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"`.

The site scrolls inside `#page-scroller`, not the window (`<html>`/`<body>`
are `overflow: hidden`), so the scripts scroll that element (`scroller.js`).

## Files

- `capture.js` – records the live site into `archive/` (headless Chrome)
- `server.js` – replays `archive/` on localhost
- `verify.js` – checks the local copy page by page
- `pages.txt` – list of pages to record
- `archive/` – recorded files + `manifest.json` (URL -> file)

## Limits

- Forms (demo request, email signup) and login talk to Artisan's backend and
  won't work offline.
- The "Aaron"/Ava chat panel renders as it does live (its start-up responses
  are recorded), but sending a message or starting a call needs Artisan's live
  AI backend, which rejects any origin but artisan.co. The local server answers
  those calls with a 503 `OFFLINE_REPLICA` error instead of pretending.
- Analytics/tracking scripts are blocked on purpose: during capture, and during
  replay via a Content-Security-Policy header (`ALLOWED` in `server.js` lists
  the few third parties pages still load, e.g. the Ashby job board on /careers).
- This contains Artisan's trademarks, copy and images. Keep it local, and
  replace the branding/content with your own before publishing anything.
