# Maisons Buyers Agency — CRM

A simple, local, dual-pipeline CRM built for a one-person buyer's agency: a **Client Pipeline** (11 stages, from Initial Consultation through Settlement) and a **Referred Partners** pipeline, switchable with one toggle in the header. No cloud service required — everything lives in a single SQLite file on this computer.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:4000** in a browser. Leave the terminal window open while you use the app; closing it stops the server.

## First run: creating your account

The first time anyone opens the app on a fresh database, it shows a **"Create Your Admin Account"** screen instead of the board — set a name, email, and password there. That becomes the first admin account. From then on, everyone signs in with an email and password (see **Accounts & users** below for adding more people).

## Where your data lives

Everything is stored in `data/maisons.db`. There's no cloud account involved in normal use — accounts are just for signing into this local app, not a hosted service.

### Backing it up

There's no in-app backup UI — instead, run `npm run backup` any time to write a timestamped snapshot of the database into the local `backups/` folder. For off-this-computer protection, point (or move) that `backups/` folder at a directory OneDrive or iCloud Drive already syncs on this Mac.

## Importing clients from a CSV

Open **⚙ Settings** → **Import clients**:

1. Not sure of the format? Click **Download CSV template** first.
2. Click **Choose CSV file** and pick your export (e.g. from GoHighLevel or another CRM).
3. The app guesses which column is which (Name, Phone, Email, Budget, Notes) — check the dropdowns and the preview table, and correct any that guessed wrong.
4. Click **Import Clients**.

Imported clients land in the first stage ("Initial Consultation") with status "Cold" — move them along as you review them.

For a very large one-time migration (e.g. ~900 GoHighLevel contacts), the command-line script is still available and does the same thing without needing to click through the UI row by row:
```bash
node scripts/import-clients-csv.js path/to/export.csv --dry-run   # preview first
node scripts/import-clients-csv.js path/to/export.csv             # then run for real
```
Its `COLUMN_MAP` (near the top of the file) may need adjusting to match your export's exact header names.

## Labels

Open **⚙ Settings** → **Labels** to create tags (name + a color from a small preset palette) — VIP, First Home Buyer, Cash Buyer, whatever's useful. Assign them to a client or partner from that record's edit modal (a row of toggleable chips near the bottom), and filter the board down to just the ones carrying a given label via the funnel icon next to search.

## Accounts & users

Every account can edit their own name, email, and password from **⚙ Settings → Account**. Admin accounts additionally see a **Users** section there to create logins for other people (e.g. Humzeh) and remove ones that shouldn't have access anymore — you can't remove your own account. There's no "forgot password" flow; an admin resetting someone's password means creating them a new login, or you can update it directly in the database if needed.

## What's in Phase 1

- Dual pipeline (Clients / Referred Partners), switchable via a toggle in the header — Referral Partners gets its own indigo highlight so it's visually distinct from Clients
- The real 11-stage client pipeline, replacing the old ad-hoc stages
- A dedicated "Log Contact" button per client for Call / Text / Voicemail, so the main board stays uncluttered — the card just shows "Last contact: Call · 2d ago"
- A budget range field (From/To dropdowns in $50k steps starting at $450k) instead of free text — editing a client with an older free-text budget (e.g. from a CSV import) leaves it untouched unless you actively pick new values
- Referred Partners pipeline with placeholder stages (New Contact → Fee Paid) — rename these any time in `db/index.js`'s `PARTNER_STAGES` list once Robert sends the real ones, then delete `data/maisons.db` and restart, or update the `pipeline_stages` rows directly
- Linking a client to the partner who referred them, with a fee note field
- Labels: create/assign/filter (see above)
- Search (with a filter button for labels, status, and referral partner), add/edit/delete for both clients and partners — click anywhere on a card to edit, not just the name
- Archive/Restore for clients, plus dedicated Board / Completed / Archived views so finished and shelved clients don't clutter the live pipeline
- Accounts: sign-in required, profile editing, and admin-managed user creation (see above)
- A Settings page (⚙ top right) for Export CSV, CSV import with column mapping and a downloadable template, and label management

## Deliberately deferred to Phase 2

- The notification bell / 30–60 day post-settlement check-in reminders
- Password reset / "forgot password" flow
- Any cloud hosting or custom domain for the real instance — this app is local-only for now. (A separate demo deployment on Render, with fictional seeded data, exists purely for sales demos — see `render.yaml` — and is unrelated to Robert's real local data.)
