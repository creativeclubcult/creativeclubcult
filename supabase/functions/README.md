# Edge functions

Three edge functions keep the admin database and the Sheet "CCC - RAB & Keuangan" in step (DESIGN.md §3). All three run with `verify_jwt` off because each one checks every request itself, and each answers 503 `not_configured` until its secrets are set.

| Function | Called by | Who is let in | Job |
| --- | --- | --- | --- |
| `sheets-sync` | pg_cron, and the admin's Refresh / Sync now | `x-sync-key` equal to `SHEETS_CRON_KEY`, or a team member's JWT | Sheet → admin pull: snapshot, diff, commit through `sheets_commit` |
| `sheets-bridge` | `syncTick` in Sync.gs, every 10 minutes | HMAC headers `x-ccc-time` and `x-ccc-sig` signed with `SHEETS_SECRET` | Fallback path: snapshot pull and running waiting ops from the Sheet side |
| `sheets-write` | The admin, for one change at a time | A team member's JWT; viewers cannot write, and money changes need money access | Admin → Sheet write-through via `sync_outbox` and the Apps Script web app |

Shared code is in `_shared/`. Settings and the Sheet side are in `ops/apps-script/README.md`. Settings come from function secrets when set, otherwise from Vault through `public.sheets_runtime_config()`; the shared secret reaches Vault only by pairing (`sheets-bridge` kind `pair`).

The live Sheet (in the Shared Drive "CCC" of hello@creativeclubcult.com since 2026-11-04) is paired only with env `prod` and the production database. `env.ts` refuses any other pairing, and it refuses the Sheet that was live before (now an archive in the personal Drive) everywhere.

## team-access: the sign in code and the team

The second step of signing in (a 6 digit code emailed after the password), adding people to the team, and links to set a password. `verify_jwt` is off; every action checks its caller.

| Action | Who | Job |
| --- | --- | --- |
| `status` | any signed-in account | On the team? Did this sign in pass a code? Are codes required? Can email go out? |
| `send` | a team member | Email a code for this sign in |
| `verify` | a team member | Check it; the first owner in with a code turns codes on for everyone |
| `invite` | an owner (after their own code, once codes are on) | Make the account, add it to the team, email a link to set a password |
| `reset` | anyone, from an origin listed exactly in `admin_origins` | A link to set a new password, only for emails on the team; the reply is the same for every email |

- Email goes out from hello@ through Gmail (`smtp.gmail.com`, port 465, TLS; edge functions can't use 25 or 587). Function secret `GMAIL_APP_PASSWORD`: an App Password of hello@ (Google Account, Security, 2-Step Verification on, App passwords). `GMAIL_USER` only when another address sends. Without the secret, `send` and `invite` answer 503 `mail_not_configured`, the admin goes in on the password alone, and Forgot password uses Supabase Auth's own email.
- The rules live in the database (`20261105_two_step.sql`, applied as `two_step_sign_in`). A code is kept as an HMAC tied to the sign in: one a minute, 5 in 15 minutes, 20 a day, 5 tries, 10 minutes to use it. Invitations and reset links: 3 an hour per address, 20 every 10 minutes in all.
- Once codes are on, `private.is_team`, `can_edit`, `can_see_money` and `is_owner` also need this sign in (the JWT's `session_id`) to have passed a code, so every table, RPC and storage rule follows. The sheets functions ask the same through `access_state` and answer 403 `needs_code`. Signing out ends the pass.
- Links in emails are `<origin>/admin/#set=<token>&t=invite|recovery`, from Supabase Auth's `generate_link`. The admin redeems them with `verifyOtp`, so no Site URL or redirect list is involved. Only an origin written exactly in `admin_origins` gets a link; a wildcard there never does.

## DEV status (2026-11-05, project `jvhhcehzhgpcphtpynnx`)

- All three are deployed. Without credentials they answer 401 (`unauthenticated`, `bad_key` or `unsigned`).
- Paired with the DEV copy "CCC - RAB & Keuangan (DEV)" (`1LMFQr-bDAgj0RwXnjkCRRALiJcj5pMm7v6QGdRCewBo`), whose web app runs Sync.gs 1.2.1 (deployment version 4).
- Reading and writing are on: `sheet_values.flags` has `pull_enabled` and `writes_enabled` true, and the copy's `SYNC_WRITES` is `on`.
- The pg_cron schedules are applied: `sheets-sync-day` every minute 06:00 to 23:59 Jakarta time, `sheets-sync-night` every 10 minutes 00:00 to 05:59, `sheets-housekeeping` every 5 minutes.
- The Supabase CLI is not installed on this machine, so DEV runs minified builds. Each function is a small loader that reads its build `<name>@<first 12 hex of the source SHA-256>` from the DEV only table `public.deploy_bundles_dev` (server key only) and runs it only when the SHA-256 matches the pin.
- Builds reach that table through `deploy-relay-dev`: a row is registered in SQL with the expected hash, and the relay stores only an upload with that hash. Between uploads the relay is a 410 stub. The same relay can hand a registered Apps Script file (`sync-gs@<sha12>`) back to the script editor, so Sync.gs reaches a copy's editor without being typed. Pins on 2026-11-05: `sheets-write@51539e0ddf2e`, `sheets-sync@5fb5ea22dd63`, `sheets-bridge@104bfc70164f`.
- `team-access` is a one-line entry from commit `ba1f40e`, like PROD. `two_step_sign_in` is applied. DEV has no Gmail secret, so codes stay off there; the sheets builds pinned above predate the code check, which makes no difference while codes are off.
- Production never gets the DEV builds; see below.

## PROD status (2026-11-05, project `zneckeqsvwbavqxpolri`)

- All three are deployed from commit `ba1f40e` of this repo (version 3; before that `833c780`, then `071465e`, which keeps amounts out of write replies for people without money access; `ba1f40e` adds the sign in code check). `team-access` is deployed from the same commit. Each function is a one-line entry that imports `https://raw.githubusercontent.com/creativeclubcult/creativeclubcult/<commit>/supabase/functions/<name>/index.ts`; the bundle is built at deploy time, so the code that runs is this folder at that commit. To ship a change, push it, then deploy the same entry with the new commit hash. With the CLI installed, `supabase functions deploy <name> --project-ref zneckeqsvwbavqxpolri --no-verify-jwt` does the same from a checkout.
- Paired with the live Sheet (env `prod`), whose web app runs Sync.gs 1.2.1 (deployment version 2). `admin_origins` is `https://creativeclubcult.com`.
- Reading is on and writing is off: `sheet_values.flags` has `pull_enabled` true and `writes_enabled` false, and the live script's `SYNC_WRITES` is `off`. Writing goes on after two days of matching figures (`ops/PRODUCTION.md`, step 9).
- The pg_cron schedules are the same as on DEV.

## Tests

```bash
deno test --no-check --allow-read --allow-env --allow-net=127.0.0.1 supabase/tests/
```

67 tests. `diff_test.ts` (49): diff, commit payloads, HMAC, MD5, and the filter that keeps amounts out of write replies for people without money access. `access_test.ts` (18): codes and their hash, email checks, the message format, a fake SMTP server (sent, refused without leaking the password, too slow), and every team-access action. The Sync.gs end to end harness runs on a synthetic DEV copy in `Work CCC/harness/sync_gs_test.ts`, which stays local.
