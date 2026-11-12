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

Same day, the other items from the list:
- Bank details: the owner typed them in Settings (row complete, saved 08:40 UTC, 15:40 WIB), so invoice links can be made. Only set or not set was checked, never the values.
- Supabase: the owner chose to stay on the Free plan for now ("mau gratis dulu"). Pro would add daily backups kept 7 days, about $35 a month with `ccc-website-dev` in the same organization. On Free the backup is the admin's Download backup (one JSON file of every table, no uploaded files), clicked in the owner's own browser, since the browser pane does not save downloads (it made the file, 120 records, but nothing reached the disk). At this point the database was 17 MB of 500 MB and Storage was empty; the project stays awake through the Sheet sync and the keep-alive workflow.
- hello@: the owner added the recovery phone (the same number as 2-Step Verification, 15:41 WIB), generated backup codes (10 available, 15:46) and verified the recovery email (15:48). Checked read-only on the account's Security page.

## Structured data on the home page, 2026-11-08

Next on the gap list ("gas"): the home page had no structured data, so search engines had to guess the site's name and logo. The owner approved the release with "naikin". Commit `3ca8346` adds 27 lines to `index.html` and nothing else: one `<script type="application/ld+json">` in the head, after the favicon link, holding two items that point at each other. Nothing on the page looks or moves differently. No admin, `/pay`, database, function or Sheet change.

- Organization: name "Creative Club Cult", alternate name "CCC", the home URL, the logo `favicon.png` (128 by 128, above Google's 112 minimum), the page's own meta description, hello@ and the Instagram profile.
- WebSite: the same name and alternate name, the home URL, language `en`, published by the Organization.

Checked before the release on the local server: the JSON parses, both items carry the fields Google lists as required, and the page and console were as before. Live: `/`, `app.js`, `styles.css` and `/careers` byte for byte the same as local, `/ops/PRODUCTION.md` still 404, and no console errors. Google's Rich Results Test on the live URL found 1 valid item, the Organization "Creative Club Cult", with no warnings (crawled 16:02 WIB); the WebSite item was checked by parsing the live page. Google decides if and when the name and logo show in search, which can take days to weeks.

Vercel: the project stays on the Hobby plan for now, the owner's choice ("vercel gapap deh yang ini dulu"). Vercel's fair use guidelines allow Hobby for non-commercial use only; Pro is $20 a month. To revisit when the owner wants.

Release: `site` and `main` at `3ca8346` (Vercel production `dpl_Ch5CDGbenX3dfiH2LcKjNT7dSp9G`, created 09:02 UTC, 16:02 WIB; the previous `main` is `7fcff27`). The notes commits `9bdc4f1`, `524c6f3`, `d16d894` and `7b9e80b` went out with it; `ops/` is not served.

Rollback: push `7fcff27` to `main` and `site` again, or Vercel's instant rollback to `dpl_3YHZvSxMLQgPuuY6wEnhL9jB6QrT`.

## Home hero plays the landing reel, 2026-11-08

From the portfolio video session: the owner approved the landing reel (v5) and the hero mockup there, asked for it to go live from this session ("okkay bro lempar ke chat room "Creative Club Cult" buat push ke live"), and approved the release here ("Naikin sekarang"). Commit `6c004f9` changes `index.html` in three places and one rule in `styles.css`, and adds the four reel files in `videos/`. No admin, `/pay`, database, function or Sheet change.

- Files: copied, not moved, from the owner's SSD (`000_CCC/Portfolio CCC/Video Portfolio/Thumbnail Web Landing`), byte for byte: `landing-reel_desktop.mp4` (1920 by 1080, 31.36 s, 15.6 MB), `landing-reel_mobile.mp4` (720 by 1280, 23.24 s, 5.3 MB) and their first frames as JPEG posters. H.264 video only, no sound track, index at the front.
- Loader: its last picture is the reel's first frame (a `<picture>`; portrait screens get the phone poster), so it opens out into the hero without a jump. app.js still finds five `img` elements in the box.
- Hero: `<video muted loop playsinline preload="auto">` with two sources; portrait screens (`max-aspect-ratio: 1/1`) get the phone cut. A small script at the end of the body sets the poster for the orientation, then plays the reel when `is-loading` goes, or at once when there is no loader. With reduced motion it stays on the poster.
- `.h-hero-media img, .h-hero-media video` get `display: block` and fill the box as the photo did.

The mockup was a copy of the main checkout, which still has the old `site` branch (`2f2bc2d`, 2026-11-03). The three commits the other session took for unreleased work (`877923b`, `41a1300`, `2f2bc2d`) have been on `main` since 2026-11-05. So only the four marked changes were carried over, onto the current page with its `.h-hero-bg` layer, without the mockup-only hooks (`?still`, `?t=`, `?img=`).

Generator: `Work CCC/_tools/gen_pages.py` (the same file in both checkouts, last edited 2026-11-07 in the morning) still has the old hero and no JSON-LD, so it was already behind `7fcff27` and `3ca8346`. Changing only the hero there would protect nothing, so it was left alone. Running it now would undo those two releases and this one: sync it with the live pages before it is used again. Synced on 2026-11-09, see "Page generator synced with the live pages" below.

Checked locally and live in headless Chrome (desktop 1440 by 900; phone 390 by 844 with an iPhone user agent; reduced motion on both):
- The reel starts within 3 ms of the loader handing over, from its first frame; on a second visit it starts at once. Desktop loads only the desktop file and poster, phones only the phone ones; nothing loads the Noxon photo now.
- The headline sits over the video, nothing scrolls sideways, and the console shows no errors.
- Reduced motion: no loader, the poster stays and the reel never plays (the browser still fetches the file, `preload="auto"`).
- Live: `/`, `styles.css`, `app.js`, both videos and both posters byte for byte as local; `admin/ui.css` and `pay/pay.js` unchanged; Range requests answer 206 with `video/mp4`, which Safari needs; `/ops/PRODUCTION.md` still 404.
- One live phone run ended the loader at 9 s instead of about 6, because the page's scripts were late that once. Two reruns ended at 6.2 and 6.5 s, and runs with the videos blocked at 6.3 and 6.2 s, so the reel does not hold the loader up.
- Not checked in Safari itself (no WebKit runner on this Mac).

Bandwidth: Vercel Hobby includes the first 100 GB of Fast Data Transfer a month. The home page had 92 views (34 visitors) from 2026-10-09 to 2026-11-08; at one full desktop reel each, that is about 1.4 GB.

Release: `site` and `main` at `6c004f9` (Vercel production `dpl_4EePuduB7oPG6dRNqsZ3PBNF4sXr`, created 16:25 UTC, 23:25 WIB; the previous `main` is `3ca8346`). The notes commit `9ecd7e8` went out with it.

Rollback: push `3ca8346` to `main` and `site` again, or Vercel's instant rollback to `dpl_Ch5CDGbenX3dfiH2LcKjNT7dSp9G`.

## Page generator synced with the live pages, 2026-11-09

`Work CCC/_tools/gen_pages.py` (gitignored, so not in this repo) builds the pages as they are live again. The hand edits of the last three releases are now in its templates:
- `7fcff27`: the hero photo layer `.h-hero-bg` behind `header.h-hero`, and the word in each "I'm applying as" button on Careers wrapped in `span.tag-tx`.
- `3ca8346`: the JSON-LD block in the home `<head>`, built by `home_jsonld()` from the home meta description.
- `6c004f9`: the hero `<video>` with both sources, the loader's last picture as the reel poster `<picture>`, and the reel script at the end of the home page, added through the new `page(post=...)` argument.

Checked: run into a scratch folder, all 24 files it writes (the pages and `sitemap.xml`) are byte for byte the committed files at `d880b96`, the same as `main` (`6c004f9`), and a second run gives the same output. All 24 were also fetched from the live site: 23 are identical, and `/project` is not served (`vercel.json` redirects it to `/work`). A made-up work added in a throwaway copy changed only the home slider, `work.html`, the new page, the previous and next links of its neighbours, `work/view.html` and `sitemap.xml`. `maintenance.html` was never generated.

Both copies (main checkout and this worktree) are the same file, md5 `2d6f727ea2b0c586ef7cfea2d9f0b5c3`. The version before the sync sits next to each as `gen_pages.py.bak-sync-live` (md5 `e2912d084178ae53e41a489ea7494a06`). No page, admin, database, function or Sheet change, and nothing released.

Before the next run into the repo, diff a scratch run against `HEAD` first: only the new work's pages should differ. A hand edit to a generated page goes back into the generator in the same change.

## Pinterest claims the site, 2026-11-09

The home `<head>` carries `<meta name="p:domain_verify" content="8fc599bc0984c9082bc11d35c418d2ce" />`, the tag Pinterest gave the CCC Pinterest account (pinterest.com/creativeclubcult, Settings, Link to Pinterest, Websites). The generator adds it to the home page only (`PINTEREST_VERIFY` in `head()`), so a regenerated `index.html` keeps it. Nothing visible changed.

Checked: a scratch run of the generator writes all 24 files byte for byte as committed, and only `index.html` has the tag. Both generator copies are md5 `25cb65f1e3ad1d884d99ece161cf00df`; the version before sits next to each as `gen_pages.py.bak-pinterest`. After the release the live home page served the tag within about 20 seconds, Home, Work, CCC, Journal, Careers, Contact and /admin answered 200, and Pinterest's claim said "Connected" for creativeclubcult.com.

Release: `site` and `main` at `c018dcc` (Vercel production `dpl_4DiaZB8iLpKUa96eAwfwkq4LNQtS`; the previous `main` is `6c004f9`). The notes commits `d880b96` and `17334b9` went out with it. The owner approved with "Ya, naikin ke live".

Rollback: push `6c004f9` to `main` and `site` again, or Vercel's instant rollback to `dpl_4EePuduB7oPG6dRNqsZ3PBNF4sXr`. Removing the tag would unclaim the site on Pinterest.

## Net profit can be 0%, 2026-11-11

The owner's rule changed: a job whose whole budget goes to the team has 0% net profit (the first is RAB 014 Denri, typed in the Sheet with net profit 0% and Kas 0%). Net profit is now 0% to 25% in whole percents for every v2 RAB tab. Before, the admin picker offered 10% to 25% (014's 0% was added at the end of the list) and the server refused 0, so once changed, 014 could not go back to 0% from the admin, and an empty cell showed as the first rate, 10%.

- Server, `supabase/functions/_shared/ops.ts`: `rab_meta` takes `net_profit_pct` from 0 to 0.25. An empty rate is still refused, so a missing rate never becomes 0%. New test in `supabase/tests/ops_test.ts`; all 95 tests pass.
- Admin, `admin/eco/projects.js` (Money, Allocation): the picker lists 0% to 25% in whole percents, and a rate typed in the Sheet that isn't a whole percent keeps its place in the list. An empty or unreadable rate shows as a disabled "Not set" and is never sent. The help line reads "Net profit can be 0% to 25%. Changing it saves to the RAB tab in the Sheet." People who may see money but not change it still see the rate as text.
- Sheet: the rule on J45 in `Template RAB`, 010, 011, 012 and 013 went from "number between 10% and 25%" (help text "Net profit 10% sampai 25%.") to 0% to 25% with "Net profit 0% sampai 25%.", and invalid input is still rejected. The values stayed as they were: Template 25%, 010 25%, 011 10%, 012 25%, 013 25%. 014 already had 0% to 25% and was not touched; 001 to 009 have no block.
  - Done with a one-off script file `TmpNetProfit` in the bound project. A dry run at 10:25 WIB listed exactly those five cells with the old rule; the apply at 10:27 WIB read each new rule back from the cell; the file was deleted at 10:28 WIB. No authorization prompt.
  - `Kode.gs` and `Sync.gs` (1.3.0) have the same length and hash before and after. The web app deployment was not touched.
  - `syncAlokasiTab_` in Sync.gs 1.3.0 still gives a block it adds the old 10% to 25% rule. That only happens for a v2 tab without the block (new tabs copy the template), so carry 0 to 0.25 over at the next Sync.gs install.
- DEV (`jvhhcehzhgpcphtpynnx`) still runs the old rule until its functions are deployed again.

Release, in the order the owner approved ("Ya, naikin ke live"):
1. Functions: `sheets-write` at 03:18 UTC and `sheets-sync` at 03:19 UTC, both from `2088e7f` (version 7 each, verify JWT off as before), through the dashboard's code editor; the MCP deploy call was refused because its schema sent booleans and lists as text. `sheets-bridge` stays on `6dd7712`. Without credentials both answer 401, and every scheduled pull after the deploy was accepted (202).
2. Sheet rule, as above.
3. Pushed: `admin-ecosystem` at `2088e7f`, then `site` and `main` (fast forward from `c018dcc`; the notes commit `9a78f34` went out with it). Vercel production `dpl_BzZRgSAhnxFySzKfGXXnhHGbkbt2`, created 03:29 UTC (10:29 WIB). The live `/admin/eco/projects.js` is byte for byte the commit's and is served `no-store`; `/`, `/admin`, `/pay` and `/work` answer 200. Only that admin file changed on the site; `ops/` and `supabase/` stay out of the deployment.

Checked locally in the harness (owner, 1280 px and 390 px): 014 shows 0% with 26 rates from 0%; picking 5% sends set 0.05 with expect 0; picking 0% from 15% sends set 0 with expect 0.15; an empty rate shows "Not set", picking it sends nothing, and 20% from empty sends expect null; 12.5% sits in its place; a money viewer sees text only; no console errors.

Live, signed in as the owner (the pane's old session had expired; the owner signed in again in the pane): 014, Money, Allocation shows 0% selected with 26 rates from 0% to 25% and the new help line; price 6.000.000, fees 300.000 and 180.000, net profit 0, Kas 0%, production budget 5.520.000, left 0; no sideways scroll at 931 px. The only console errors are the expired session's `team-access` 401 and `logout` 403 at page load, before the sign in; every call after it answered 200. A no change save, `rab_meta` with set 0 and expect 0 on 014 (op `b255c75f-717e-4c04-bedc-058338ad05f9`, 03:44 UTC), answered 200 in about 10 seconds, which the old rule refused; the Sheet's answer was `noop: ["net_profit_pct"]` with nothing written, and the outbox has no open rows.

Rollback (all three together; the old admin and the old server refuse 0, so 014 could not be set back to 0% from the admin):
- Functions: deploy `sheets-write` and `sheets-sync` again with the import at `6dd7712399ac60dbcd1a1030d9a43ff7fbd6080b`.
- Sheet: put J45 in `Template RAB` and 010 to 013 back to "number between 0.1 and 0.25" with "Net profit 10% sampai 25%.", only where the rate is 10% or more by then. Leave 014.
- Admin: push `c018dcc` to `main` and `site` again, or Vercel's instant rollback to `dpl_4DiaZB8iLpKUa96eAwfwkq4LNQtS`.

Noticed, not changed: the tab `013 ALURA - Music Video` has no row in Rekap Project, so PROD has no project for it (its rule changed with the others); 012 still has no RAB layout in PROD, so its RAB is not read.

## Portfolio photos, gallery layout, uploaded films and RAB numbering, 2026-11-12 (live since 10:45 WIB, Sheet numbered at 11:00)

From the owner's notes of 2026-11-11. The owner chose: photos and the gallery layout; films stored in Supabase ("Supabase (gratis, berisiko)": about 20 MB each, the Free plan's storage and traffic risk accepted); the NO column numbering itself in each section of `Template RAB`, 010, 011 and 014, never 001 to 009, 012 or 013; and the bug to fix is "numbers skip after a delete or an add". Held until the owner ticks them: services and industries typed by hand, and the Behance style image preview on the project page.

Admin, Website & Portfolio editor (`admin/admin.js`, `admin/admin.css`, `admin/index.html`):
- Photos: up to 30 MB a file (was 15 MB), JPG, PNG, WebP or AVIF. The browser turns each one the camera's way up, drops its metadata and resizes it to 2560 px on the long edge, then saves it as WebP 0.82 where it makes WebP (Safari doesn't), else JPEG 0.85, or PNG for a file with real transparency when there is no WebP. A stored file is at most 15 MiB. Several at once (a gallery holds up to 40), by Add images or by dropping them on the Gallery; one message names every file skipped and why. Paths `<item id>/<base36 time>-<6 random>.<ext>`, cached for a year, one retry per upload.
- Gallery layout: a new image gets its size from its shape (wide, 1.2:1 or more, is Full width; portraits in pairs are Half; a run of three or more is halves, then thirds at the end; a lone one is Full). Auto layout sets every size again, and any size can still be changed by hand. Rows move by a drag handle or the up and down buttons (keyboard too). The Layout preview under the list draws the rows the way the project page does.
- Alt text: Publish and a live Save mark each gallery image still without alt text, and a mark clears as its text is typed.
- Film: an uploaded MP4 (H.264), up to 20 MB, in its own buckets. The admin reads the codec from the file (avc1 or avc3; MOV, HEVC, ProRes, AV1, VP9 and files cut short are refused with a message), checks that it plays, and takes the poster from the frame at 1 s; the slider and "Use this frame as the poster" pick another. An upload is refused when the project's storage would pass 700 MB (used plus twice the file), and a failed storage read refuses too, never read as 0. Progress, one retry, a stall watchdog (60 s, or 120 s once the file is sent) and Cancel. A project shows one film: an upload or a YouTube link.
- From the verification round: uploads stay in the editor when the draft save after them fails; text typed while a save runs is kept; closing without saving removes this editor's unsaved photos, covers, films and posters from the drafts buckets, keeping anything the last save or the row as it is now uses; on a phone a message sits above the editor's bar and inside the screen; .m4v counts as MP4; on iPhone and iPad the MOV message says to save the MP4 to Files and pick it with Choose File; a video that loads only as far as its metadata until moved or played (iPhone Safari) is moved to the frame it needs.
- CSP: `media-src` adds the two Supabase hosts, so the editor can play the film.

Public project page (`portfolio.js`, and `styles.css` +10 lines scoped to `[data-pf-rows]` at 601 px and up):
- Gallery rows: the images in a row share its height, and their widths follow their shapes. A lone half or third shows full width. Phones keep one column, as before.
- Film: `<video controls playsinline preload="none" poster>`, so nothing loads until play. Projects with a YouTube link keep it.
- `portfolio.js` reads the four film columns. When the database answers 42703 (no such column: before the migration, or after its rollback) it reads once more without them, so every project still shows, without uploaded films. Any other failure fails as before, never as an empty list.
- Draft preview: photos and the poster are signed for 10 minutes, the film for an hour.

RAB (`admin/eco/rab.js`): the admin no longer sends `no`, because the Sheet numbers itself. New lines start at Qty 1 and Days 1, Add a line opens in the section used last on that project, and after a saved add the form opens again in that section.

Not in git (`Work CCC/`): `migrations/20261112_portfolio_video.sql` with `_rollback.sql` and `_tests.sql` (104 cases); `rab-numbering/NoOtomatis.gs` (noOtomatisCek writes nothing, noOtomatisPasang installs, noOtomatisLepas undoes) and `rab-numbering/INSTALL-LIVE.md`. The formula sits in A on each section's first item row and counts the rows with a description down to the section's TOTAL, so a deleted or added line renumbers the rest.

DEV (`jvhhcehzhgpcphtpynnx`): the migration is applied (version `20261111195359`), and the tests file passes 104/104 in a transaction that rolls back. On the DEV Sheet, `Template RAB`, `010` and `011` carry the formula and the note on each NO header (DEV has no `014`). The DEV Apps Script project holds only `Kode.gs` and `Sync.gs`, both unchanged (sha256 prefixes `5552113afb35daf8` and `d147dadf5c33f54b`).

NoOtomatis.gs rehearsal on the DEV Sheet, 2026-11-12 10:20 to 10:32 WIB, with the file as it is in `Work CCC/rab-numbering` (13924 bytes, sha256 prefix `98f3015cb101fd4a`) pasted as a third script file and deleted afterwards: noOtomatisCek planned 27 sections (Template RAB, 010, 011; 014 logged as no such tab); noOtomatisPasang wrote them in 47 s, every section's read back matched, and each NO header got its note; noOtomatisCek then found all 27 already numbered; noOtomatisLepas kept every number as a typed number and took the formulas and notes out in 27 s, and noOtomatisCek after it said the numbers stay the same in all 27; noOtomatisPasang again left DEV numbered. Editor quirk: the function list next to Run once showed noOtomatisPasang while Run still ran noOtomatisCek (picked with the keyboard), so INSTALL-LIVE.md now says to pick with the mouse and read the log's first line (`Check only, nothing written`, `Install` or `Undo`).

Checked: six build suites, then six adversarial verifiers (33 findings: 3 high, 9 medium, 21 low), three fixers (30 fixed), then every suite again from fresh headless Chrome profiles with PROD's hosts unresolvable: no regression. 57 admin and public pages at desktop and phone have clean consoles; the 23 public pages have 0 DOM differences from HEAD at desktop and phone, and project pages differ only by the new rows.

Open:
- Not tried on a device: iPhone (iOS 26 Safari) and Mac Safari for the photos (no WebP there), the film check and poster, the MOV route, and a stored film playing on the public page. iPhone video loading was only emulated in Chrome.
- No real upload round trip yet, on DEV or PROD: it needs the owner's sign in. The owner's first use from the iPhone (release step 5) is the first one.
- Low, not fixed: a photo that comes out upside down or mirrored isn't caught in a browser whose createImageBitmap ignores the camera's orientation (current Safari and Chrome apply it); try an upside down camera JPEG from the iPhone in that first use. A Half pair of a 10:1 panorama and a 2:3 portrait, set by hand, shrinks the portrait (the preview shows it; Auto layout makes the panorama full width).
- Next Sync.gs install: Make PDF should warn while the NO column shows #REF!; `syncSpillColumn_` should find the formula anywhere in A of a section (after a row is inserted above a section's first line, Remove line on that row is refused); the DEV M6 line test still sends `no`; and `syncAlokasiTab_` still needs 0 to 0.25 (2026-11-11).
- Uploads stay in the drafts buckets when the tab or the browser closes before a save (filmLeft doesn't run then). A server side sweep of draft files no row uses would close it.
- A save that fails on the network says "Failed to fetch" as it is.
- The migration's header says portfolio.js fails as a whole before the migration; with the 42703 retry it only loses the films. The order stays, because admin.js writes the film columns.
- On a real Sheet NoOtomatis.gs has not yet met merged cells, text or another formula in A, or a row inserted above a first line (neither DEV nor the live Sheet had one); those paths ran only in the simulator.
- Not yet done live: INSTALL-LIVE.md check 4 (Add line, then Remove line, on a numbered tab from the admin). It writes in a client's quote, so it waits for the owner's yes.

Release, each step with the owner's yes, in this order:
1. PROD migration: `Work CCC/migrations/20261112_portfolio_video.sql` through apply_migration on `zneckeqsvwbavqxpolri`. Then anon reads `video_path, video_poster_path, video_w, video_h` (200), the advisors show nothing new, both video buckets exist (20 MB, video/mp4 only) and the fingerprint matches DEV.
2. Push `admin-ecosystem`, then `site`, then `main`, one ref per command. portfolio.js and styles.css go out together with admin.js.
3. Reload every open admin tab: an old tab still sends `no`, and saves no film.
4. Live Sheet: NoOtomatis as `Work CCC/rab-numbering/INSTALL-LIVE.md` says (Template RAB, 010, 011, 014).
5. First real use: a batch of photos and a short MP4 on a draft, publish, and look at it on the iPhone.

Released on 2026-11-12. The owner answered "Naikin live" for the whole order, and "Pasang sekarang" after seeing noOtomatisCek's numbers:
1. About 10:41 WIB, PROD migration `portfolio_video` through apply_migration on `zneckeqsvwbavqxpolri`. Its fingerprint (4 functions with grants, 4 columns, 4 constraints, 1 trigger, 2 buckets, 6 storage policies, 1 function comment) equals DEV's, `cecfa63aeed67a563595243418c3594b`. The security advisors list nothing new. Anon with the public key: the four film columns 200, `created_by` 401, `rpc/portfolio_storage_used` 42501.
2. 10:45 WIB, `7a1aa22` pushed to `admin-ecosystem`, `site` and `main`, all three fast forwards. Production deploy `dpl_EdRzktDdAHQu8nZMe26LCLdacc7J` READY. Live `admin/admin.js`, `admin/admin.css`, `admin/eco/rab.js` (keepPick), `/admin`, `portfolio.js` and `styles.css` are byte for byte the commit's. `/work` shows the same four projects as before (PROD has no published portfolio item yet), and its `portfolio_items` read with the film columns answers 200. Consoles clean on `/work`, a project page and the admin. `/ops/PRODUCTION.md` and `Work CCC` answer 404.
3. The Team is one person, the owner. Settings showed no Changes waiting before the Sheet step.
4. 10:54 to 11:01 WIB, live Sheet. NoOtomatis.gs added to its script project `1z_LudaBt1FbwnMgbDRjzlcJOAW9JvnMnymeVqMLEOXzu9T7I2n-xPISZ` ("Project tak berjudul", 13924 chars, `98f3015cb101fd4a`), by hello@ in the pane.
   - The live `Kode.gs` is not DEV's: 37949 chars, sha256 prefix `1426d907ab38c04c` (DEV `5552113afb35daf8`). Checked before the paste: no name in common with NoOtomatis.gs and no top level statement. `buatRabBaru` writes only H8, F11, F14, J13 and J14. `onEdit` acts on column I only. `onChangeRab`, `rapikanAlat_` and `siapkanAlatRab_` write column A only inside Equipment. `removeRows_` runs only on Kas and Rekap Project. Its formulas use `;`.
   - `Sync.gs` is DEV's (`d147dadf5c33f54b`). Both files were unchanged after the install, and the admin kept reading the Sheet (11:02, 11:05).
   - noOtomatisCek at 10:55 planned 35 sections. Numbers change only in 010 (A72, A78 to A82, A151, A157, A163 and A164) and 014 (A148 to A151): empty NO cells of lines with a description, none to 1 and up. 010 and 014 are Draft.
   - noOtomatisPasang ran 10:59:58 to 11:00:42 (44 s). It wrote 35 sections, every read back matched, and no CHECK THIS line came up. 011's typed numbers were cleared and show the same numbers from the formula. A second run said "already numbered" for all 35 (011 has no LOCATION & PERMIT).
5. Check: the gviz CSV of Template RAB, 010, 011 and 014, taken before and after, compared cell by cell. Template RAB and 011 are identical. 010 differs in exactly the 10 cells of A above, and 014 in the 4. The totals stayed: 010 Rp 12.253.600, 011 Rp 33.435.250 and 014 Rp 6.000.000, with no new change log entry, nothing waiting and no new open issue.
6. File > Print of 014: this Sheet's print settings have Show notes ticked, so the notes page lists the nine new NO header notes next to the template's own ([1] to [11] and more). The admin's Make PDF leaves notes out (`printnotes=false`).

Rollback, in this order:
- Sheet: run noOtomatisLepas (INSTALL-LIVE.md, Undo) before the admin goes back to any version before this rab.js, such as `2088e7f` or `c018dcc`. An old admin sends `no`, and the formula refuses it.
- Code: push `2088e7f` to `main` and `site` again, or Vercel's instant rollback to `dpl_BzZRgSAhnxFySzKfGXXnhHGbkbt2`.
- Database, after the code: `Work CCC/migrations/20261112_portfolio_video_rollback.sql`. It deletes no file; a video bucket that still holds files stays until it is emptied in the dashboard.

## What the owner does

- Approve this rollout once (production database, functions, live Sheet script, release).
- If Google asks for access when the web app is deployed: click Allow (hello@).
- After the release: sign in at creativeclubcult.com/admin once so the pages can be checked signed in.
- Codes by email (done 2026-11-05): on hello@, create an App Password (myaccount.google.com/apppasswords; 2-Step Verification has to be on), save it as the function secret `GMAIL_APP_PASSWORD` in Supabase (Edge Functions, Secrets), then sign in at /admin once with the password and the emailed code. That turns codes on for everyone.
- Invoice links (live since 2026-11-07): type CCC's bank details once in Settings, Bank details (bank, account number, account holder, a note in Indonesian). Then, on Finance, Collect makes a link for an invoice at Deal that is still owed, by email, WhatsApp or copy.
