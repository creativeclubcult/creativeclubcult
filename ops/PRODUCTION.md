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
9. Writes stay off until 2026-11-07, after the daily parity checks.

## What the owner does

- Approve this rollout once (production database, functions, live Sheet script, release).
- If Google asks for access when the web app is deployed: click Allow (hello@).
- After the release: sign in at creativeclubcult.com/admin once so the pages can be checked signed in.
