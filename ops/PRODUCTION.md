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

## Admin fixes from the tutorial videos, 2026-11-07

Recording the admin tutorial videos showed three front end bugs in `56dd5af`. The owner approved the fix ("gas kerjain") and the release ("gas naikin ke live"). Commit `de0535c` changes only `admin/ui.css` and `admin/eco/core.js`: no database, function or Sheet change.

- Overview, To collect: a KPI card under 380 px lists Paid, Overdue and Not due yet as rows, the amount on the right (a container query on `.kpis>.kpi`). Before, the three amounts ran into each other at 1280 px.
- Needs you, Pay crew: `E.waited` counts a calendar day from the Sheet as whole days in Jakarta, as Oldest unpaid does. Before, it was a day short from 00:00 to 07:00 WIB.
- Careers, Open roles: the Settings role tile rules are scoped to `div.roles`, so `table.tbl.roles` lays out as a table again. From 761 to 1280 px a role's title and summary wrap, so On the site stays inside the card.

Checked before the release on the local harness with sample data: every page at 1280, 1024 and 390 px as owner, editor, viewer and money viewer, with no error and no sideways scroll; Pay crew equal to Oldest unpaid at 23:59, 00:00, 03:00, 06:59 and 07:00 WIB; the Settings tiles unchanged.

Release: `admin-ecosystem`, `site` and `main` at `de0535c` (Vercel production `dpl_GNx9EWsNT7bKSWPZ7XWs6FHGTXyc`, ready at 01:38 UTC, 08:38 WIB; the previous `main` is `56dd5af`). The 19 files under `admin/` are live byte for byte (`index.html` as `/admin`), `ui.css` is still `no-store`, and the home page answers 200. Signed in as the owner (the session already in the browser, reading only, nothing clicked): the 13 admin pages load with no error, no sideways scroll and nothing past the edge at 1280, 1024 and 390 px, and the Settings tiles are the same 4 column grid. Today's data shows none of the three: To collect is Rp 0 (no invoice at Deal), nothing is owed to crew, and Careers has no open roles.

Rollback: push `56dd5af` to `main` and `site` again, or Vercel's instant rollback to `dpl_9jwnHVxkJWZa8DV5FXF3CdzyXGby`.

## Public site fixes from the device audit, 2026-11-07

The owner asked for an audit of the whole site, above all on phones, and approved the release ("Ya, naikin ke live"). Commit `44dc1a8` changes only public files: `app.js`, `portfolio.js`, `styles.css`, `index.html`, `work.html` and `work/view.html`. No admin, `/pay`, database, function or Sheet change.

- Home, intro hand-over on phones and tablets: touch devices scroll natively (ScrollSmoother's `smooth()` is 0 there and the content never moves), so the hand-over read the content offset as 0 and set the scroll back to the hero before gliding down again. `visualScroll` now reads the scroll itself on touch devices; desktop is unchanged. The jump had been there since 2026-10-17.
- Home, intro: on phones the plus sat on "[ INTRODUCTION ]". With no room left of the text it now starts at the right end of the label's line.
- Home: the BTS photo placeholder (a dashed box with a production note) is gone. The panel stays black behind "We have no rules, but we have standards." until a real photo is chosen.
- Work and project pages: `app.js` is preloaded and the connection to Supabase opens early; if `portfolio.js` never arrives the page starts `app.js` itself; the 2.5 s limit now covers the whole answer, not only its headers.
- Home CTA heading: at 320 px it kept 32 px and touched both edges. It now shrinks to `min(32px, 9vw)`.
- `.on-light .eyebrow`: contrast 4.49 to 4.82:1.

Checked before the release on the local server: home, Work, the project view, a project page and the journal at 390, 320 and 1280 px, with no sideways scroll, no failed request, no cookie, and hidden elements equal to live or fewer. A mocked published project joins the Work grid, reveals, filters and opens.

Release: `site` and `main` at `44dc1a8` (Vercel production `dpl_Cd8x63nZsLUigYCDWSRwMJgRyLPp`, ready by 04:23 UTC, 11:23 WIB; the previous `main` is `de0535c`). Live byte for byte: `/`, `/work`, `/work/view`, `app.js`, `portfolio.js` and `styles.css`, and, unchanged, `/admin`, `admin/ui.css`, `admin/eco/core.js`, `/pay` and `pay/pay.js`. On the live home page the hand-over keeps its place: the scroll climbs from 1913 to 2448 on an iPhone (390 px) and from 1857 to 2536 on an iPad (768 px), never back, and the plus starts at the end of the label's line; the laptop traces as before. The 20 public pages at 390, 320 and 1280 px: no sideways scroll, no broken image, no failed request but the deliberate 404 test, and no cookie stored (Supabase's answers carry a `__cf_bm` Set-Cookie, which the browser drops because the requests go without credentials). The iPhone and laptop results equal the audit run before the release. At 320 px the home page went from 15 hidden elements to 1, and Work from 16 hidden cards and one failed request to none.

Rollback: push `de0535c` to `main` and `site` again, or Vercel's instant rollback to `dpl_GNx9EWsNT7bKSWPZ7XWs6FHGTXyc`.

## Phone scrolling and the giant titles, 2026-11-07

The owner sent a screen recording from an iPhone (Safari): pictures shook while scrolling and the Journal title on the home page was wrong. They approved the release ("Ya, naikin ke live"). Commit `defd803` changes only `app.js` and `styles.css`. No admin, `/pay`, database, function or Sheet change.

- Phones and tablets scroll natively (ScrollSmoother's `smooth()` is 0), so a scrubbed transform or a ScrollTrigger pin is set a frame after Safari has already moved the page, and it shakes. When `smooth()` is 0, `app.js` now sets `html.is-native-scroll`. Then the home hero, the project photo (`.pstory-bg`), the Careers curtain (`.cr-hero`) and the Journal side columns are held by `position: sticky`. These drifts are off: the hero's inner layer, the full-bleed photo, the end panel, the project photo and the Journal cards. Opacity scrubs stay (shades, veils, the hero title fade, the Journal thumbs). Desktop is unchanged.
- The home hero, sticky on phones, is hidden (`.is-covered`) once the black section is half a screen over it, so it can't show through further down. A plain scroll listener sets it: a ScrollTrigger toggle missed the first scroll after the intro's scripted hand-back and left the hero hidden at the top.
- `.fit` titles are measured with the letters at rest (before, the letters could still be tilted for their fall, so the word read wider than it is). They keep room for ink that reaches past the first and last letter's box (canvas `actualBoundingBoxLeft/Right`, plus 1 px a side), and fit again when a font finishes loading (`document.fonts` `loadingdone`, and once `700 1em Heros` has loaded). ScrollTrigger refreshes only if a size changed. Safari can resolve `fonts.ready` before the bold face starts loading. At 390 px "Journal" goes from 109.7 to 119.5 px with its ink 2.9 and 2.6 px inside the edges, and "Selected Work" from 62.5 to 61.3 px with its k 1.0 px inside instead of 2.6 px past the edge. At 1440 px "Journal" is unchanged (441.4 px). "Selected Work" goes from 230.7 to 227.3 px, because its k had been clipped by about 9 px.

Checked before the release on the local server (Chrome device emulation; no iOS Simulator or WebKit runner on this Mac). iPhone: the hero holds while the black section covers it, and it is visible again at the top after the hand-over and back. The MOVANA photo holds over exactly the range of the desktop pin. The Careers curtain holds, and the Journal page has no drifts. iPad: the Journal side columns hold. Laptop and desktop: everything as before. The bold font held back 4 s still ends at the right sizes. A font load forced after the titles were spoiled fits them again. Nine public pages show no sideways scroll and no new console message.

Release: `site` and `main` at `defd803` (Vercel production `dpl_HYXTgXSm4Xg9MRGLquxZJ6iqnKbp`, created 09:22 UTC, 16:22 WIB; the previous `main` is `44dc1a8`).

- Live byte for byte: `/`, `app.js` and `styles.css`. `admin/ui.css` and `pay/pay.js` are unchanged. `app.js` is served with `max-age=0, must-revalidate`, so a plain reload picks it up.
- Nine public pages, on iPhone and desktop: no sideways scroll, no failed request and no broken image. The console shows only the known "Deprecated API for given entry type" warning and lazy-load notices.
- Live on the iPhone: the titles come out at the sizes measured locally. After the hand-over and a finger scroll back to the top, the hero's shade is 0 and its title fully visible. On MOVANA the photo stays at the top until the gallery reaches it (scroll 1876), then leaves with it, with no pin and no transform on the image.

Known and left as it was: right after the intro's scripted hand-back, ScrollSmoother skips the next scroll event. A single scripted jump to the top at that moment leaves the hero's shade at 0.8 and its title hidden until the next scroll. Nothing on the home page makes such a jump, and scrolling by finger is right. It was the same before this release.

Rollback: push `44dc1a8` to `main` and `site` again, or Vercel's instant rollback to `dpl_Cd8x63nZsLUigYCDWSRwMJgRyLPp`.

## Hero parallax and centred pill words, 2026-11-07

The owner asked for the home hero's words to move apart from the photo behind them, for a parallax feel, and said the word in the Careers pill wasn't centred. They approved the two mockups ("gasss kerjain") and then the release ("okke gass"). Commit `7fcff27` changes `index.html`, `styles.css`, `app.js` and `careers.html`. No admin, `/pay`, database, function or Sheet change.

- Home hero: the photo and its shade sit on their own layer, `.h-hero-bg` (`aria-hidden`), behind `header.h-hero`, which now holds only the title and the line under it. The layer's negative bottom margin (`max(100svh, 560px)`) puts the header over it. The scroll timeline is the same as before. On desktop the photo sinks (`yPercent` 80, so it moves about 0.04 of the scroll on screen) and darkens, while the words now rise with the page at full speed as they fade. On phones and tablets the photo holds still (sticky, now on `.h-hero-bg`) and `.is-covered` hides it once the black section is half a screen over it; the words scroll natively, so there is still no scrubbed transform on phones.
- Pills: the Heros font sits its letters low in the line (about 0.036 em in Chrome, about 0.064 em in the owner's Safari), so the words looked dropped inside their outlines. Under `@supports (text-box: trim-both cap alphabetic)` the line is trimmed to the capitals and the baseline, and `padding-block` adds back `(1lh - 1cap) / 2`, so the words are centred and every pill keeps its size. This covers `.nav-careers` (with `.nav-links` aligned on the baseline and a -4px margin), `.menu-tag`, `.tag` (now inline-block, since a flex box's bare text can't be trimmed), `.dept-state` (inline-block), `.job-more` and the careers track buttons, which keep flex for their arrow and trim a `span.tag-tx` around the word. Browsers without `text-box` (Firefox) keep the old look. `.btn` is unchanged (0.34 px low).

Checked before the release on the local server (Chrome device emulation; no Safari or WebKit runner on this Mac). The desktop and iPhone frames match the approved mockup: on desktop the title moves 135 px for 135 px of scroll while the photo moves 5; on iPhone the photo stays at 0. On iPhone and iPad the photo is hidden 1.7 screens down and visible again at the top, with the title fully shown. Every pill measures the same space above its capitals as below its baseline (to 0.01 px), with heights unchanged (25.16, 22, 32.38, 28.38 and 46.77 px). The header stays 51.19 px with all four nav words on one baseline. A local mock role (never sent anywhere) showed "Read the role" and "Hiring now" centred too. Seven pages on iPhone and desktop show no sideways scroll, and their console and hidden-element counts match the live site before the release.

Release: `site` and `main` at `7fcff27` (Vercel production `dpl_3YHZvSxMLQgPuuY6wEnhL9jB6QrT`, created 12:19 UTC, 19:19 WIB; the previous `main` is `defd803`). The notes commit `d8e0c23` went out with it.

- Live byte for byte: `/`, `app.js`, `styles.css` and `careers.html`. `admin/ui.css` and `pay/pay.js` are unchanged.
- Live, the hero frames and every pill give the same numbers as locally. Nine public pages, on iPhone and desktop: no sideways scroll, no failed request and no broken image. The console shows only the known "Deprecated API for given entry type" warning and lazy-load notices.
- Not checked in Safari itself; the owner was asked to look at the Careers pill on their iPhone or Mac.

Known and left as it was: a scripted jump three screens down lands in the intro, which holds the page while it plays, so a scripted jump back to the top right after it is ignored. The live site did the same before this release, and scrolling by finger is right.

Rollback: push `defd803` to `main` and `site` again, or Vercel's instant rollback to `dpl_HYXTgXSm4Xg9MRGLquxZJ6iqnKbp`.

## Email authentication (Google DKIM and DMARC), 2026-11-08

From the gap list the owner approved ("gas mulai yang penting dulu"): the domain had SPF for Google and Resend's own DKIM, but no DMARC and no Google DKIM. Mail sent through Google (hello@ in Gmail, the Sheet's Apps Script, the sign in code and team emails that go through Gmail SMTP) carried SPF only. No code, database or release change.

- Hostinger DNS (hPanel, DNS / Nameservers): two TXT records, TTL 14400. Claude filled the form; the safety check stops Claude from saving DNS changes, so the owner clicked "Add 2 records".
  - `_dmarc`: `v=DMARC1; p=none; rua=mailto:hello@creativeclubcult.com`. Monitoring only, nothing is blocked. Daily reports ("Report domain: creativeclubcult.com") arrive at hello@.
  - `google._domainkey`: the 2048-bit key from Google Admin (410 characters). Hostinger stores it as two strings that join to Google's value exactly.
- Google Admin, Apps, Google Workspace, Gmail, Authenticate email: the key was already generated; the owner clicked Start authentication. Status: "Authenticating email with DKIM", nothing left unsaved.
- Untouched: every record from 2026-11-06 (Resend DKIM, `send` SPF and MX, `rsend`), the root SPF, MX, A, `www` and the Google site verification.

Checked: both records answer on atlas and hyperion (the domain's own nameservers) and on 8.8.8.8 and 1.1.1.1; the DKIM value matches Google's character for character. Not checked yet: a real message showing DKIM pass and DMARC pass; the first daily reports will show it.

Next: after about two weeks of reports with nothing unexpected (around 2026-11-22), change `p=none` to `p=quarantine`.

Rollback: delete the two TXT rows in hPanel, and Stop authentication in Google Admin.

Same day, still with the owner: Supabase is on the Free plan with no card on file (Pro gives daily backups kept 7 days; keeping `ccc-website-dev` in the same organization makes it about $35 a month), `pay_settings` is still empty, and hello@ has no recovery phone, an unverified recovery email and no backup codes. The admin's Download backup made its file (120 records), but the browser pane does not save downloads, so it has to be clicked in the owner's own browser.

## What the owner does

- Approve this rollout once (production database, functions, live Sheet script, release).
- If Google asks for access when the web app is deployed: click Allow (hello@).
- After the release: sign in at creativeclubcult.com/admin once so the pages can be checked signed in.
- Codes by email (done 2026-11-05): on hello@, create an App Password (myaccount.google.com/apppasswords; 2-Step Verification has to be on), save it as the function secret `GMAIL_APP_PASSWORD` in Supabase (Edge Functions, Secrets), then sign in at /admin once with the password and the emailed code. That turns codes on for everyone.
- Invoice links (live since 2026-11-07): type CCC's bank details once in Settings, Bank details (bank, account number, account holder, a note in Indonesian). Then, on Finance, Collect makes a link for an invoice at Deal that is still owed, by email, WhatsApp or copy.
