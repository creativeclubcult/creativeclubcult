# Admin ecosystem: production rollout (M7)

Goal: the admin at creativeclubcult.com/admin shows the live Sheet "CCC - RAB & Keuangan" (projects, clients, crew, Kas, finance, reports) and, after two clean days, can write back to it. DEV (`jvhhcehzhgpcphtpynnx` + the DEV copy of the Sheet) stays as the test bench.

Every step only adds. Nothing existing in the production database, the live Sheet or its `Kode.gs` is dropped, renamed or rewritten.

## Steps, checks and rollback

| # | Step | Check | Rollback |
| --- | --- | --- | --- |
| 1 | Push branch `admin-ecosystem` (commit `833c780`). The functions are deployed from this commit, so the code that runs is exactly the code in the repo. | `git ls-remote` shows the commit | none needed (the branch is not the site) |
| 2 | PROD database (`zneckeqsvwbavqxpolri`): `20261104_admin_ecosystem.sql` in 4 parts, then `20261104_sheets_pairing.sql`. Flags start at `pull_enabled: true, writes_enabled: false`. | Security and performance advisors; the fingerprint of every added object (functions with grants, columns, constraints, indexes, policies, triggers, table grants, RLS, the view) equals DEV's | the rollback block at the top of each file |
| 3 | Functions `sheets-sync`, `sheets-bridge`, `sheets-write` (verify_jwt off: each checks every request itself) | Without credentials: 401; before settings: 503 `not_configured` | delete the three functions |
| 4 | Settings in PROD Vault: live Sheet id, env `prod`, `admin_origins` = `https://creativeclubcult.com` | `sheets_runtime_config()` returns them (secret not printed) | `delete from vault.secrets where name in (...)` |
| 5 | Live Sheet: add `Sync.gs` (Sync 1.2.1, hash checked before saving), deploy the web app (execute as hello@, anyone), store its URL, open pairing, run `syncSetup` (pairs, `SYNC_WRITES=off`, installs `syncTick`), run `syncSelfTest` | self test `ok: true`; `Kode.gs` unchanged; `onChangeRab` and `kasDariForm` still installed | `syncUninstall`, delete the web app deployment and the Sync file |
| 6 | Schedules: `20261104_admin_ecosystem_schedules.sql` with the PROD URL (pulls every minute 06:00 to 23:59 WIB, every 10 minutes at night, housekeeping every 5 minutes) | first pull fills the mirror; `sync_runs` ok; no unexplained `sync_issues` | `cron.unschedule(...)` from the file header |
| 7 | Parity: admin figures equal the Sheet (`report_check(year)` per year, project and Kas counts, totals) | 0 differences | flags `pull_enabled: false` |
| 8 | Release the admin: `admin-ecosystem` into `site`, `site` to `main` (Vercel) | every admin page at 390 and 1440 px, console clean, signed in as the owner | push the previous `main` (6ef14d2) again |
| 9 | Two days read-only with a daily parity check, then writes on: flags `writes_enabled: true` and `syncWritesOn` in the live script | parity 0 on both days | `syncWritesOff` and flags `writes_enabled: false` |

DEV keeps its own schedules. Its pulls can be paused (`pull_enabled: false` on DEV) when nobody is testing, so the two environments don't both use hello@'s Apps Script quota. They were paused on 2026-11-05, right after PROD went live; set `pull_enabled` back to `true` on DEV before testing there.

## Status on 2026-11-05

1. Pushed: `admin-ecosystem` at `833c780`.
2. Applied as `admin_ecosystem_1_tables`, `admin_ecosystem_2_triggers_rls`, `admin_ecosystem_3_sync_rpcs`, `admin_ecosystem_4_admin_rpcs_cron_fns` and `sheets_pairing`. Columns, constraints, indexes, policies, triggers, table grants and the view match DEV exactly. The 30 functions match DEV once comments are left out (DEV got the file without comments, PROD keeps them). Advisors: only the intended "no policy" note on `sync_state`.
3. Deployed from commit `833c780`: each function is a one-line entry that imports its `index.ts` from raw.githubusercontent.com at that commit, bundled at deploy time. Without credentials all three answer 401. CORS lets in `https://creativeclubcult.com` only.
4. Vault holds the live Sheet id, env `prod`, `admin_origins` and the web app URL.
5. Live script: the `Sync` file has the repo's Sync.gs 1.2.1 (SHA-256 checked), web app version 2 executes as hello@ for anyone, `syncSetup` paired with env `prod` (`SYNC_WRITES=off`, `syncTick` next to `onChangeRab` and `kasDariForm`), `syncSelfTest` is `ok`. `Kode.gs` has the same SHA-256 before and after.
6. Schedules applied. Run 1 read 12 projects, 13 clients and the summaries, with no issues.
7. Parity 2026: `report_check` matches (10 Deal or Lunas projects, omset, cost and profit). Rekap 12 rows, Client 13, Kas 0 and Crew 0, the same as the Sheet (its Kas and Crew tabs have no rows yet).
8. Released: see the commit that moves `main` past `6ef14d2`.
9. Writes on since 16:09 UTC (23:09 WIB), two days early at the owner's request, together with the admin's editing screens (commit `190eaaf` on `site` and `main`; the previous `main` is `ba1f40e`).
   - Right before: parity 2026 matched (10 Deal or Lunas projects, omset 29.399.200, cost 3.000.000, profit 0; Rekap 12, Client 13, Kas 0, Crew 0). `report_check` returns null without a signed-in money user, so the same comparison was run as SQL.
   - `syncWritesOn` ran in the live script editor (Sheet, Extensions, Apps Script; log "Writes from the admin: on"), then `flags.writes_enabled` went to true. The next pull kept it.
   - First real write at 17:14 UTC: `client_upsert` for DRV (PIC and phone) was done in 7 seconds. Row 10 of the Client tab shows it, the activity log has "edited client", and there are no sync issues.
   - Rollback: `syncWritesOff` in the live script and `writes_enabled: false`; for the code, push `ba1f40e` to `main` again.

## Security audit on 2026-11-05

Done after the release, before anyone else joins the team. Two gaps were closed for team members without money access; neither had been used, since the owner was the only account and Sheet writes are still off.

1. Sheet write replies. Locking prices, a new RAB or a status change gets the whole tab back from the Sheet, amounts included. `sheets-write` now sends that record through `withoutMoney()` for anyone without money access, and the outbox keeps only the redacted record. The three functions were deployed again from commit `071465e` (each is version 2). The pull right after it was `connected`.
2. Activity list. Kas events, and events about quote, invoice and receipt PDFs, were readable by the whole team. `20261105_activity_money.sql` (applied as `activity_money`) limits them to money access. Rollback is in the file header.

Checked after both: without credentials the three functions answer 401, the publishable key alone gets "Sign in to the admin first.", and `activity_log` and `sync_outbox` refuse anonymous reads. Advisors are unchanged.

3. Crew accounts. The owner chose to keep people's details and lead budgets from crew: `20261105_people_editors.sql` (applied as `people_editors`) limits applicants, network sign-ups, leads, their files and lead events to owners and admins, and `overview_flow` sends null (not 0) for the counts a viewer can't read. Read as the owner, every count was the same before and after; a signed-in account outside the team reads nothing. The admin pages that follow it (menu, overview, client and project details, Reports) are commit `cb689a8`; they went live with `ba1f40e` (below).

## Sign in code and Team on 2026-11-05

The owner asked for the password and then a code sent to the person's email, and for a way to add finance and crew. Signing in is now email and password, then a 6 digit code that `team-access` emails from hello@. Owners add people in Settings, Team (Admin or Viewer, money on or off); each gets an email with a link to set their password.

| # | Step | Check | Rollback |
| --- | --- | --- | --- |
| 1 | PROD database: `20261105_two_step.sql`, applied as `two_step_sign_in`. The switch `private.access_rules.two_step` starts off. | The 13 functions and 4 tables equal DEV's; read as the owner, every table count is the same before and after; the publishable key gets `permission denied` from every `access_*` function | at once: `update private.access_rules set two_step = false;` then the block at the top of the file |
| 2 | Function `team-access` from commit `ba1f40e` (verify_jwt off) | Without a sign in: 401; reset from another site: 403; preflight from another site gets no CORS header | delete the function |
| 3 | `sheets-write`, `sheets-sync`, `sheets-bridge` from `ba1f40e` (version 3; they also ask whether this sign in passed a code) | Without credentials: 401; the next pull is `connected` | switch off first (step 1), then deploy the three from `071465e` again |
| 4 | Release: `site` and `main` to `ba1f40e` (Vercel) | /admin at 390 and 1440 px, console clean | push `ae90ad3` to `main` again |

Until the Gmail App Password is saved, nothing changes for anyone: the password alone signs in (status says `mail: false`), adding people is greyed out with a note, and Forgot password uses Supabase Auth's own email. Codes become required for everyone the first time an owner signs in with one, so the email is proven to arrive before anyone depends on it. From then on a sign in that hasn't passed a code reads and changes nothing, in the database itself and in the sheets functions (403 `needs_code`).

Codes are on since 10:46 UTC (17:46 WIB) the same day. hello@ turned on 2-Step Verification at 17:37 WIB (until then Google's App passwords page says "The setting you are looking for is not available for your account"), the App Password became the function secret `GMAIL_APP_PASSWORD`, and the owner set a new admin password through the emailed reset link (the first email through Gmail), then passed a code, which turned codes on. The password change ended hello@'s older sessions. Afterwards every admin read answered 200 and the Sheet pull stayed `connected`.

If email stops, nobody can sign in: changing hello@'s Google password, turning its 2-Step Verification off or deleting the App Password each ends the App Password. Then switch codes off at once (`update private.access_rules set two_step = false;`), make a new App Password, save it over the secret, and sign in with a code, which turns codes on again. Supabase Auth's Site URL is still `http://localhost:3000`; nothing uses it while email goes through `team-access`, but the fallback reset email (sent when the Gmail secret is missing) needs it set to `https://creativeclubcult.com`.

Tested on DEV inside rolled back transactions: with the switch on, a sign in without a pass reads 0 rows and all four helpers say false; after a pass it reads as before; another sign in of the same person, someone else's session id, a signed out session and a token without `session_id` all read nothing. Codes: a wait of 60 seconds between two, wrong tries counting down from 4 left, the 5th wrong try spends the code (the right one is refused after it), expiry, a used code is gone, the 6th code in 15 minutes is refused, a viewer's pass does not turn codes on and an owner's does. The team can't lose its last owner (update or delete), and handing over first works.

## RAB lines from the admin (M6), 2026-11-06

The owner asked to edit RAB lines from the admin. On a project page (RABs from 010 on, for editors with money access):

- Budget: edit, add and remove lines in every breakdown section and in Equipment. Gear comes from Katalog Alat; a price typed in the admin is locked, an empty one follows the catalog. Removing a line empties its row, and the row stays in the tab.
- Costs and profit: the ten actual costs and "Biaya lain di luar RAB" (estimate and actual).

Each change is one op through `sheets-write`. The Sheet works the totals out again and its reply refreshes the admin. A line that moved in the Sheet meanwhile is refused (`line_moved`) instead of written to the wrong row. RABs 001 to 009 stay read only. The database schema does not change.

Tested on DEV, 2026-11-06:

- `syncDevLineTest` in the DEV copy: all 41 checks passed. Every section took a third line in an inserted row and two gear groups a fourth; a stale value gave a conflict and a forced save went through; a row inserted above the section gave `line_moved`; a removed row was reused by the next add; a replayed add was not added twice; actual costs and Biaya lain saved; a SUB TOTAL with a fixed range was refused and the inserted row undone; no other sheet's formulas changed.
- Through the DEV functions and web app version 5, on tab 012: a Pre-Production line was added and its cost changed, a Lens item was added at its catalog price (2 × 25.000), an actual cost and Biaya lain were saved, then both lines were removed and the amounts emptied. Every op was done on its first attempt, the totals followed (3.000.000 to 3.300.000 and back to 3.000.000), and there were no sync issues and no failed ops.
- The admin screens were checked against the local harness at 1440 and 390 px with a clean console. They have not been used against DEV signed in yet, which needs a DEV sign in.

Rollout on PROD, approved by the owner ("oke rilis") and done on 2026-11-05 between 20:50 and 21:05 UTC (03:50 to 04:05 WIB on 2026-11-06):

| # | Step | Check | Rollback |
| --- | --- | --- | --- |
| 1 | Commit on `admin-ecosystem` and push the branch | `git ls-remote` shows the commit | none needed |
| 2 | Live script: replace the `Sync` file with Sync.gs 1.3.0 (SHA-256 `d147dadf5c33…` checked before saving), then Deploy, Manage deployments, Edit, New version, and run `syncSelfTest` | self test `ok` with version 1.3.0; `Kode.gs` has the same SHA-256; the `webapp_version_mismatch` issue closes on the next pull | paste Sync.gs 1.2.1 (`291c0bd4dd23…`) back and deploy a new version |
| 3 | Functions `sheets-write`, `sheets-sync`, `sheets-bridge` from the pushed commit | without credentials 401; the next pull is `connected` | deploy the three from `ba1f40e` again |
| 4 | Release: `admin-ecosystem` into `site`, `site` to `main` | a project page at 390 and 1440 px, console clean; the gear list loads; the owner's first real edit shows in the Sheet | push `190eaaf` to `main` again |

Each step is harmless on its own: Sync.gs 1.3.0 only adds ops that the older functions never send, and the older Sync.gs answers them with "not switched on yet". To stop all writes at any point: `syncWritesOff` in the live script and `writes_enabled` false.

Status:

1. Pushed: `admin-ecosystem` at `6dd7712`.
2. Live script: the `Sync` file holds Sync.gs 1.3.0 (SHA-256 `d147dadf5c33…`), deployed as web app version 3 "Sync 1.3.0" at 20:53 UTC with the same `/exec` URL. `syncSelfTest` is `ok` with version 1.3.0: every header, the template, all 12 RAB tabs (001 to 009 v1; 010 to 012 v2 with every section and Equipment), the Code.gs symbols, the mirrors and the three triggers; `SYNC_WRITES` stays `on`. `Kode.gs` has the same SHA-256 (`1426d907ab38…`).
3. Functions deployed from `6dd7712` at 20:58 UTC (each is version 5). Without credentials all three answer 401, the catalog read included. The database functions M6 uses equal DEV's once comments are left out, so the schema needed nothing. The pull at 21:00 UTC read web app 1.3.0 and was `connected`, with no changes and no warnings; the `webapp_version_mismatch` issue closed by itself at 21:04 UTC.
4. Released: `site` and `main` at `6dd7712` (Vercel production ready at 21:01 UTC; the previous `main` is `190eaaf`). The live `/admin` page is byte for byte the commit's, and `ops/` and `supabase/` still answer 404. Signed in as the owner, project 010 shows the Budget editor at 1440 and 390 px with no console errors and no sideways scroll. Editing a gear line loaded Katalog Alat (308 items) and showed the line's locked price; the form was cancelled, so nothing was written. The owner's first real edit (010, row 99, the lens item) arrived in the Sheet at 22:30 UTC.

### Tested on PROD, fixes released 2026-11-05 23:08 UTC (06:08 WIB on 2026-11-06)

At the owner's request ("coba lu yang ngetes sendiri"), every M6 write was tried on the live admin against 011, and each change was undone the same way, with the Sheet read back after each step: editing a line, adding and removing a line in a plain section and in Equipment, changing a quantity, locking and unlocking a gear price, and saving actual costs and Biaya lain. The Sheet's totals, PPN BSM and terbilang followed each time. 011 is back to its starting state (GRAND TOTAL 14.800.750, Equipment 4.800.750, TOTAL BIAYA KELUAR 18.300.750 both columns).

Found and fixed in `6da90b2` (front end only; no function, script or schema change):

- On a line with a locked price, picking other equipment kept the old price. The owner's edit on 010 left Tamron 20mm (catalog 50.000) at Sony's locked 300.000. Now the price follows the picked equipment (its catalog price, still locked; empty when the catalog has none) unless a price was typed in the form, and the item the line had brings its own price back.
- The actual costs total added up only the typed actuals (570.000 against the Sheet's 18.370.750 during the test). It now shows TOTAL BIAYA KELUAR, where an empty actual counts as its estimate, and an empty actual shows its estimate as the placeholder instead of 0. The read only cost table also lists Biaya lain.
- Margins were the stored ratio, rounded to four places, which showed −23,7% where Rekap Project shows −23,6%. They are now profit over omset.

Release: `site` and `main` at `6da90b2` (the previous `main` is `6dd7712`; the owner approved the push to `main` in chat). The four live admin files are byte for byte the commit's. Checked signed in at 1440 and 390 px with a clean console and no sideways scroll: on 010 the gear form took another lens's catalog price and gave the locked price back for the line's own item, without saving; 011 shows margin −23,6% and totals 18.300.750 and 18.300.750; Reports and 012 show their margins.

At the owner's choice, 010 row 99 was put back to Sony FE 24-70mm F2.8 GM II Lens (BSM) at the locked 300.000 through the fixed form (one op, only the item written). The Sheet row is the original again (vendor BSM, 29 Okt 26), Equipment is 1.953.600 again with PPN BSM, and `project_money` followed. Afterwards: 15 ops all `done`, 0 open sync issues.

## Admin v3: redesign, leads board, calendar, collections and invoice links, 2026-11-07

The owner asked for the admin to follow the first mockup, and for next steps on leads, a Leads board, a shoot calendar, collections by age with a WhatsApp reminder, search with quick actions, and a private invoice link for clients. The link is the half version: no payment gateway, which needs a merchant account first. Built and checked on DEV and the local harness (`Work CCC/eco-design/PLAN_V3.md`, Delivery Gate in `Work CCC/eco-design/DELIVERY_GATE_2026-11-06.md`), committed as `56dd5af`.

Rollout on PROD, approved by the owner in chat ("gass naik kelive dan lanjut 4 langkah"), done on 2026-11-06 between 18:01 and 18:06 UTC (01:01 to 01:06 WIB on 2026-11-07):

| # | Step | Check | Rollback |
| --- | --- | --- | --- |
| 1 | PROD database: `20261106_followups_paylinks.sql` (all five sections in one file), applied as `followups_paylinks`. Before it: nothing named `pay_*` existed, every table, column and helper it uses was there, `lead_follows_project()` was the one in `20261104_admin_ecosystem.sql` (same hash), and the 12 function bodies in the file had DEV's hashes. | One fingerprint of everything it adds or replaces (function bodies with settings and grants, the view, constraints, RLS and table grants, column grants, policies, indexes, triggers, the cron job, comments) equals DEV's; advisors; the publishable key is refused | after rows 3 and 2: the two blocks at the top of the file. Dropping `pay_links` and `pay_settings` deletes the links and bank details made since, so that is the owner's call |
| 2 | Push `admin-ecosystem`, then functions `pay-link` and `pay-page` from `56dd5af` (verify_jwt off) | the function files raw.githubusercontent.com serves at that commit equal the commit; CORS for the site only; 405, 400, 401 and 404 answers | delete the two functions |
| 3 | Release: `site` and `main` to `56dd5af` (Vercel) | live files byte for byte the commit's; the `/pay` headers; every admin page signed in as the owner | push `6da90b2` to `main` and `site` again, or Vercel's instant rollback to `dpl_9aZvxitdDwN8d8A3JdPgdeGzBDfg` |

Status:

1. Applied at 18:01 UTC (version `20261106180130`). PROD and DEV give the same fingerprint (`05dcfbdc…`), part by part. The security advisors add one note, the intended "no policy" on `private.pay_hits` (like the sign in tables); the leaked password WARN is the Auth setting it was before. With the publishable key, `pay_settings`, `pay_links` and `lead_inbox` answer 401, and `pay_page_view` and `pay_link_create` answer "permission denied for function". `pay-housekeeping` runs at minute 29 of every hour.
2. `admin-ecosystem` pushed at `56dd5af`; both functions deployed at 18:04 UTC (version 1). The 11 function files GitHub serves at that commit equal the commit. `pay-link` without a sign in, or with a fake token, answers 401. `pay-page` answers 204 with CORS for `https://creativeclubcult.com` and without it for another site, 405 for GET, 400 for an unknown action, 404 for a malformed token without asking the database, and 404 for a well formed dead token through the database. That check and the browser check in step 3 left two dead link counts in `private.pay_hits`, which housekeeping drops after a day.
3. `site` and `main` at `56dd5af` (Vercel production `dpl_9jwnHVxkJWZa8DV5FXF3CdzyXGby`, ready by 18:06 UTC; the previous `main` is `6da90b2`). Nothing outside `admin/`, `pay/`, `supabase/`, `ops/` and `vercel.json` changed, and the live `/`, `/admin` and `/pay` files are byte for byte the commit's. `/pay` sends its CSP, `no-store`, `no-referrer` and `noindex`; `/supabase/…`, `/Work CCC/…` and `/ops/…` answer 404. Signed in as the owner (the session already in the browser, reading only, no action clicked): all 14 admin pages load with no error, nothing left Loading, no sideways scroll at 1211 px and a clean console, and the Overview at 375 px as well. Finance reads the Sheet (to collect Rp 0: no invoice is at Deal, 10 are Lunas and 2 Draft), and Settings shows the empty Bank details card. `/pay` without a token says "Link ini tidak lengkap."; with a dead token, "Link ini sudah tidak berlaku." The home page loads with every file 200.

Still open:

- CCC's bank details: the owner types them in Settings, Bank details. Until then no link can be made (`no_bank`).
- The first real link: from Finance, Collect, on an invoice at Deal that is still owed. Today there is none.
- The payment gateway: not built; it needs a merchant account.

## What the owner does

- Approve this rollout once (production database, functions, live Sheet script, release).
- If Google asks for access when the web app is deployed: click Allow (hello@).
- After the release: sign in at creativeclubcult.com/admin once so the pages can be checked signed in.
- Codes by email (done 2026-11-05): on hello@, create an App Password (myaccount.google.com/apppasswords; 2-Step Verification has to be on), save it as the function secret `GMAIL_APP_PASSWORD` in Supabase (Edge Functions, Secrets), then sign in at /admin once with the password and the emailed code. That turns codes on for everyone.
- Invoice links (live since 2026-11-07): type CCC's bank details once in Settings, Bank details (bank, account number, account holder, a note in Indonesian). Then, on Finance, Collect makes a link for an invoice at Deal that is still owed, by email, WhatsApp or copy.
