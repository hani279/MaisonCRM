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

Two options, use both if you can:

1. **OneDrive (recommended)** — move (or symlink) the whole `maisons-crm` folder into a OneDrive-synced folder on your computer. Every change to `data/maisons.db` will sync automatically, the same as any other file.
2. **Manual snapshot** — run `npm run backup` any time to copy the current database into `backups/` with a timestamp in the filename, as a second safety net.

## Importing your existing GoHighLevel contacts

1. Export your contacts from GoHighLevel as a CSV.
2. Open `scripts/import-clients-csv.js` and check the `COLUMN_MAP` object near the top against your CSV's actual column headers (e.g. `Name`, `Phone`, `Email`) — adjust it if your export uses different header names.
3. Do a dry run first, which prints what would be imported without touching the database:
   ```bash
   node scripts/import-clients-csv.js path/to/export.csv --dry-run
   ```
4. Once the dry-run output looks right, run it for real:
   ```bash
   node scripts/import-clients-csv.js path/to/export.csv
   ```

Imported clients land in the first stage ("Initial Consultation") with status "Cold" — move them along as you review them.

## What's in Phase 1

- Dual pipeline (Clients / Referred Partners) behind one toggle
- The real 14-stage client pipeline, replacing the old ad-hoc stages
- A dedicated "Log Contact" button per client for Call / Text / Voicemail, so the main board stays uncluttered — the card just shows "Last contact: Call · 2d ago"
- Status color-coding per client: Cold / Engaged / Active-Hot / Settled / Lost (the field is a plain dropdown, easy to relabel later)
- Referred Partners pipeline with placeholder stages (New Contact → Fee Paid) — rename these any time in `db/index.js`'s `PARTNER_STAGES` list once Robert sends the real ones, then delete `data/maisons.db` and restart, or update the `pipeline_stages` rows directly
- Linking a client to the partner who referred them, with a fee note field
- Search, Export CSV, add/edit/delete for both clients and partners

## Deliberately deferred to Phase 2

- The notification bell / 30–60 day post-settlement check-in reminders
- Any cloud hosting or custom domain — this app is local-only for now
