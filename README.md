# Maisons Buyers Agency — CRM

A simple, local, dual-pipeline CRM built for a one-person buyer's agency: a **Client Pipeline** (14 stages, from Initial Consultation through Handover) and a **Referred Partners** pipeline, switchable with one toggle. No cloud service required — everything lives in a single SQLite file on this computer.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:4000** in a browser. Leave the terminal window open while you use the app; closing it stops the server.

## Where your data lives

Everything is stored in `data/maisons.db`. There is nothing else to manage — no cloud account, no login.

### Backing it up

Open **⚙ Settings** in the app (top right) → **Backup**:

1. Paste in the path to a folder that OneDrive or iCloud Drive already syncs on this computer (e.g. `/Users/rob/Library/Mobile Documents/com~apple~CloudDocs/MaisonsCRM Backups` for iCloud Drive on a Mac) and click **Save Folder**.
2. Click **Back Up Now** any time to write a timestamped snapshot of the database into that folder. OneDrive/iCloud then syncs it off this computer automatically — the app itself never needs an account, sign-in, or internet access to do this.

There's also `npm run backup`, which does the same thing but drops the snapshot into the local `backups/` folder — handy as a quick manual safety net alongside the synced one.

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

## What's in Phase 1

- Dual pipeline (Clients / Referred Partners) behind one toggle
- The real 14-stage client pipeline, replacing the old ad-hoc stages
- A dedicated "Log Contact" button per client for Call / Text / Voicemail, so the main board stays uncluttered — the card just shows "Last contact: Call · 2d ago"
- Status color-coding per client: Cold / Engaged / Active-Hot / Settled / Lost (the field is a plain dropdown, easy to relabel later)
- Referred Partners pipeline with placeholder stages (New Contact → Fee Paid) — rename these any time in `db/index.js`'s `PARTNER_STAGES` list once Robert sends the real ones, then delete `data/maisons.db` and restart, or update the `pipeline_stages` rows directly
- Linking a client to the partner who referred them, with a fee note field
- Search, add/edit/delete for both clients and partners
- Archive/Restore for clients, plus dedicated Board / Completed / Archived views so finished and shelved clients don't clutter the live pipeline
- A Settings page (⚙ top right) for Export CSV, CSV import with column mapping and a downloadable template, and backup-to-a-synced-folder

## Deliberately deferred to Phase 2

- The notification bell / 30–60 day post-settlement check-in reminders
- Any cloud hosting or custom domain — this app is local-only for now
