# Sheet sync functions

Three edge functions keep the admin database and the Sheet "CCC - RAB & Keuangan" in step (DESIGN.md §3). All three run with `verify_jwt` off because each one checks every request itself, and each answers 503 `not_configured` until its secrets are set.

| Function | Called by | Who is let in | Job |
| --- | --- | --- | --- |
| `sheets-sync` | pg_cron, and the admin's Refresh / Sync now | `x-sync-key` equal to `SHEETS_CRON_KEY`, or a team member's JWT | Sheet → admin pull: snapshot, diff, commit through `sheets_commit` |
| `sheets-bridge` | `syncTick` in Sync.gs, every 10 minutes | HMAC headers `x-ccc-time` and `x-ccc-sig` signed with `SHEETS_SECRET` | Fallback path: snapshot pull and running waiting ops from the Sheet side |
| `sheets-write` | The admin, for one change at a time | A team member's JWT; viewers cannot write, and money changes need money access | Admin → Sheet write-through via `sync_outbox` and the Apps Script web app |

Shared code is in `_shared/`. Settings and the Sheet side are in `ops/apps-script/README.md`. Settings come from function secrets when set, otherwise from Vault through `public.sheets_runtime_config()`; the shared secret reaches Vault only by pairing (`sheets-bridge` kind `pair`).

The live Sheet (in the Shared Drive "CCC" of hello@creativeclubcult.com since 2026-11-04) is paired only with env `prod` and the production database. `env.ts` refuses any other pairing, and it refuses the Sheet that was live before (now an archive in the personal Drive) everywhere.

## DEV status (2026-11-05, project `jvhhcehzhgpcphtpynnx`)

- All three are deployed. Without credentials they answer 401 (`unauthenticated`, `bad_key` or `unsigned`).
- Paired with the DEV copy "CCC - RAB & Keuangan (DEV)" (`1LMFQr-bDAgj0RwXnjkCRRALiJcj5pMm7v6QGdRCewBo`), whose web app runs Sync.gs 1.2.1 (deployment version 4).
- Reading and writing are on: `sheet_values.flags` has `pull_enabled` and `writes_enabled` true, and the copy's `SYNC_WRITES` is `on`.
- The pg_cron schedules are applied: `sheets-sync-day` every minute 06:00 to 23:59 Jakarta time, `sheets-sync-night` every 10 minutes 00:00 to 05:59, `sheets-housekeeping` every 5 minutes.
- The Supabase CLI is not installed on this machine, so DEV runs minified builds. Each function is a small loader that reads its build `<name>@<first 12 hex of the source SHA-256>` from the DEV only table `public.deploy_bundles_dev` (server key only) and runs it only when the SHA-256 matches the pin.
- Builds reach that table through `deploy-relay-dev`: a row is registered in SQL with the expected hash, and the relay stores only an upload with that hash. Between uploads the relay is a 410 stub. The same relay can hand a registered Apps Script file (`sync-gs@<sha12>`) back to the script editor, so Sync.gs reaches a copy's editor without being typed. Pins on 2026-11-05: `sheets-write@51539e0ddf2e`, `sheets-sync@5fb5ea22dd63`, `sheets-bridge@104bfc70164f`.
- Production never gets the DEV builds; see below.

## PROD status (2026-11-05, project `zneckeqsvwbavqxpolri`)

- All three are deployed from commit `071465e` of this repo (first `833c780`; `071465e` keeps amounts out of write replies for people without money access). Each function is a one-line entry that imports `https://raw.githubusercontent.com/creativeclubcult/creativeclubcult/<commit>/supabase/functions/<name>/index.ts`; the bundle is built at deploy time, so the code that runs is this folder at that commit. To ship a change, push it, then deploy the same entry with the new commit hash. With the CLI installed, `supabase functions deploy <name> --project-ref zneckeqsvwbavqxpolri --no-verify-jwt` does the same from a checkout.
- Paired with the live Sheet (env `prod`), whose web app runs Sync.gs 1.2.1 (deployment version 2). `admin_origins` is `https://creativeclubcult.com`.
- Reading is on and writing is off: `sheet_values.flags` has `pull_enabled` true and `writes_enabled` false, and the live script's `SYNC_WRITES` is `off`. Writing goes on after two days of matching figures (`ops/PRODUCTION.md`, step 9).
- The pg_cron schedules are the same as on DEV.

## Tests

```bash
deno test --no-check --allow-read --allow-env supabase/tests/diff_test.ts
```

49 tests (diff, commit payloads, HMAC, MD5, and the filter that keeps amounts out of write replies for people without money access). The Sync.gs end to end harness runs on a synthetic DEV copy in `Work CCC/harness/sync_gs_test.ts`, which stays local.
