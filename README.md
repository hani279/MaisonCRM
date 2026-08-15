# Maisons Buyers Agency — CRM

A dual-pipeline CRM built for a one-person buyer's agency: a **Client Pipeline** (11 stages, from Initial Consultation through Settlement) and a **Referred Partners** pipeline, switchable with one toggle in the header.

Data lives in [Supabase](https://supabase.com) (hosted Postgres) rather than a local file, and accounts are handled by Supabase Auth. The real app and the sales-demo deployment share one Supabase project but are fully isolated from each other — see **Architecture** below.

## Running it

```bash
npm install
npm start
```

Then open **http://localhost:4000** in a browser. Leave the terminal window open while you use the app; closing it stops the server.

### First-time setup (new machine or new Supabase project)

1. Copy `.env.example`-style values into a `.env` file in the project root: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all three from your Supabase project's Settings → API page), and `DATABASE_URL` (Settings → Database → Connect → **Session pooler** connection string — the direct connection string is IPv6-only and won't work on most home networks).
2. Create the tables: `node scripts/init-supabase-schema.js public`
3. `npm start`, then open the app and use the **"Create Your Admin Account"** screen — set a name, email, and password there. That becomes the first admin account.

From then on, everyone signs in with an email and password (see **Accounts & users** below for adding more people).

## Architecture

Both the real app and the demo deployment run the exact same code against the **same Supabase project**, kept apart by **Postgres schema**: real data lives in the `public` schema, demo data lives in a separate `demo` schema. Which one a given deployment uses is controlled by the `PGSCHEMA` environment variable (defaults to `public` if unset — that's what your local `.env` should do). Table names in the code are always unqualified (`clients`, `partners`, ...); Postgres resolves them to the right schema automatically.

Supabase Auth's user list is project-wide, not schema-scoped, so on top of that: every account is tagged at creation time with which schema owns it, and both the API layer and the login screen enforce that a login only ever works against its own deployment — a demo login can't sign into the real app's data (or vice versa), and each deployment's Settings → Users only shows its own accounts.

### Accounts

Public self-registration is never exposed to the browser. The first admin account is created through the app's own "Create Your Admin Account" screen (backed by `POST /api/auth/setup`, gated to only work once per schema), and every other login is created by an admin from **⚙ Settings → Users**. Both go through Supabase's service-role Admin API server-side — the browser only ever holds the public anon key.

## Deploying the real app on Vercel

The Express app runs as a single Vercel serverless function (`api/index.js` exports it; `vercel.json` routes every request there — see those two files if you're curious how). To deploy:

1. Import this repo into a new Vercel project (or `vercel` from the CLI).
2. In the project's Environment Variables settings, set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL` to the same values as your local `.env` (leave `PGSCHEMA` unset so it defaults to `public` — the real data).
3. Deploy. No build step is needed (`vercel.json` has no `builds`/`framework` config — it's picked up as a plain Node project).

The demo deployment is unaffected by this and still runs on Render (`render.yaml`) — nothing about it changes.

### Backing it up

Run `npm run backup` any time to write a timestamped `pg_dump` of the real (`public` schema) data into the local `backups/` folder. Requires the Postgres client tools (`pg_dump`) — if you don't have them: `brew install libpq` and add it to your PATH (the script will tell you if it's missing). For off-this-computer protection, point (or move) `backups/` at a directory OneDrive or iCloud Drive already syncs on this Mac.

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

Every account can edit their own name, email, and password from **⚙ Settings → Account** (this talks to Supabase Auth directly from the browser — changing your email may require confirming via a link Supabase emails you, depending on your project's auth settings). Admin accounts additionally see a **Users** section there to create logins for other people (e.g. Humzeh) and remove ones that shouldn't have access anymore — you can't remove your own account. There's no "forgot password" flow; an admin resetting someone's password means creating them a new login.

## What's in Phase 1

- Dual pipeline (Clients / Referred Partners), switchable via a toggle in the header — Referral Partners gets its own indigo highlight so it's visually distinct from Clients
- The real 11-stage client pipeline, replacing the old ad-hoc stages
- A dedicated "Log Contact" button per client for Call / Text / Voicemail, so the main board stays uncluttered — the card just shows "Last contact: Call · 2d ago"
- A budget range field (From/To dropdowns in $50k steps starting at $450k) instead of free text — editing a client with an older free-text budget (e.g. from a CSV import) leaves it untouched unless you actively pick new values
- Referred Partners pipeline (New Contact → Fee Paid)
- Linking a client to the partner who referred them, with a fee note field
- Labels: create/assign/filter (see above)
- Search (with a filter button for labels, status, and referral partner), add/edit/delete for both clients and partners — click anywhere on a card to edit, not just the name
- Archive/Restore for clients, plus dedicated Board / Completed / Archived views so finished and shelved clients don't clutter the live pipeline
- Accounts: Supabase Auth sign-in, self-service profile editing, and admin-managed user creation (see above)
- A Settings page (⚙ top right) for Export CSV, CSV import with column mapping and a downloadable template, and label management

## Demo deployment

A separate deployment (Render, see `render.yaml`) runs the same app against the `demo` Postgres schema with fictional seeded data, for showing prospective purchasers around without touching Robert's real data. Demo login: `demo@maisons.example` / `demo1234`.

- `node scripts/seed-demo-supabase.js` (re)creates the `demo.demo_reset()` Postgres function, runs it once to seed the demo schema, and ensures the demo login exists. Safe to re-run any time.
- `POST /api/demo/reset` (admin-only, only registered when `PGSCHEMA=demo`) calls that same function on demand — useful right before a demo call.
- To have it clean itself up automatically, enable the **pg_cron** extension in the Supabase dashboard (Database → Extensions), then run once in the SQL editor:
  ```sql
  select cron.schedule('demo-reset', '0 */6 * * *', 'select demo.demo_reset()');
  ```

## Deliberately deferred to Phase 2

- The notification bell / 30–60 day post-settlement check-in reminders
- Password reset / "forgot password" flow
