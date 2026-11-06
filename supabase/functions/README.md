# Edge functions

Three edge functions keep the admin database and the Sheet "CCC - RAB & Keuangan" in step (DESIGN.md §3). All three run with `verify_jwt` off because each one checks every request itself, and each answers 503 `not_configured` until its secrets are set.

| Function | Called by | Who is let in | Job |
| --- | --- | --- | --- |
| `sheets-sync` | pg_cron, and the admin's Refresh / Sync now | `x-sync-key` equal to `SHEETS_CRON_KEY`, or a team member's JWT | Sheet → admin pull: snapshot, diff, commit through `sheets_commit`. `{"kind": "catalog"}` reads Katalog Alat for the admin's gear picker (editors with money access) |
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

## pay-link and pay-page: the private invoice link

A link to one invoice that the client opens without signing in: `<origin>/pay#<token>` shows what is owed, CCC's bank details, and a "Saya sudah transfer" button. It is the half version of an online invoice: there is no payment gateway, because that needs a merchant account first. Both run with `verify_jwt` off and check every request themselves. The rules live in the database (`Work CCC/migrations/20261106_followups_paylinks.sql`, section 5), and the page is `pay/` at the site root.

| Function | Called by | Who is let in | Job |
| --- | --- | --- | --- |
| `pay-link` | Finance, the Collect panel | An owner, or an admin with money access, past the emailed code, from an origin written exactly in `admin_origins` | `create` (`via` email, whatsapp or copy) and `revoke`. Email sends the invoice summary in Indonesian from hello@ |
| `pay-page` | The public page `/pay` | Anyone holding a live token | `view`: that one invoice, the bank details and the link's dates, nothing else, and the view is counted. `paid`: once per link, emails the team when Gmail is set up |

- The token is 43 characters of base64url; the database keeps only its SHA-256. A link works for 60 days, until it is turned off, or until the invoice leaves Deal and Lunas or Rekap Project. Every dead, unknown or malformed link gets the same 404.
- A link is made only for a billed invoice (Deal or Lunas) that is still owed, and only once CCC's bank details are filled in (Settings; owners edit them, money users read them). No link is made while the Sheet has no amount for the invoice (`no_amount`). If the amount is cleared after a link is out, the page shows no amount rather than Rp 0 and asks the client to check by email, and "Saya sudah transfer" still reaches the team. Once the Sheet shows the invoice as paid, "Saya sudah transfer" answers 409 `nothing_owed`.
- Limits: 20 links per person in 10 minutes, 3 invoice emails an hour to one address. On the page, by an HMAC of the caller's address: 30 asks a minute, 10 dead links in 10 minutes, 300 dead links in 10 minutes from everyone. `pay-housekeeping` (pg_cron, hourly) drops counts older than a day.
- Without `GMAIL_APP_PASSWORD`, `create` by email answers 503 `mail_not_configured` before anything is made; copy and WhatsApp still work, and `paid` is recorded without an email (the admin shows it on Finance either way).
- The page's own CSP allows only its files and the two Supabase function URLs; `vercel.json` sends a stricter one for `/pay` (PROD only), plus `no-store`, `no-referrer` and `noindex`.

## DEV status (2026-11-06, project `jvhhcehzhgpcphtpynnx`)

- All three are deployed. Without credentials they answer 401 (`unauthenticated`, `bad_key` or `unsigned`).
- Paired with the DEV copy "CCC - RAB & Keuangan (DEV)" (`1LMFQr-bDAgj0RwXnjkCRRALiJcj5pMm7v6QGdRCewBo`), whose web app runs Sync.gs 1.3.0 (deployment version 5, the RAB line ops of M6).
- Writing is on (`writes_enabled` true, the copy's `SYNC_WRITES` is `on`). Pulls are paused between tests (`pull_enabled` false); set it to true before testing.
- The pg_cron schedules are applied: `sheets-sync-day` every minute 06:00 to 23:59 Jakarta time, `sheets-sync-night` every 10 minutes 00:00 to 05:59, `sheets-housekeeping` every 5 minutes.
- The Supabase CLI is not installed on this machine, so DEV runs minified builds. Each function is a small loader that reads its build `<name>@<first 12 hex of the source SHA-256>` from the DEV only table `public.deploy_bundles_dev` (server key only) and runs it only when the SHA-256 matches the pin.
- Builds reach that table through `deploy-relay-dev`: a row is registered in SQL with the expected hash, and the relay stores only an upload with that hash. Between uploads the relay is a 410 stub. The same relay can hand a registered Apps Script file (`sync-gs@<sha12>`) back to the script editor, so Sync.gs reaches a copy's editor without being typed. Pins on 2026-11-06: `sheets-write@f40baac1831f`, `sheets-sync@51d19b507e64`, `sheets-bridge@7196f85e97b4`.
- `team-access` is a one-line entry from commit `ba1f40e`, like PROD. `two_step_sign_in` is applied. DEV has no Gmail secret, so codes stay off there.
- `pay-link` and `pay-page` are deployed the same way (function version 2 since 2026-11-06 08:02 UTC): pins `pay-link@b76554a505af` and `pay-page@00c98964f2f6`. The database side is applied as `followups_paylinks`, `lead_quote_sent`, `pay_functions` and `pay_owed_unknown`. Checked on DEV: CORS for listed origins only, 400/401/404 answers, a real link's view and "Saya sudah transfer" with no amount in the Sheet (no Rp 0), 409 on a paid invoice, a turned off link gives 404, the dead link limit gives 429. Every test link was removed afterwards.
- Not yet possible on DEV: making a link from the admin. That needs an origin written exactly in `admin_origins` (DEV lists wildcards only), CCC's bank details in Settings, and an invoice that is still owed. Email needs `GMAIL_APP_PASSWORD`.
- Production never gets the DEV builds; see below.

## PROD status (2026-11-06 18:06 UTC, project `zneckeqsvwbavqxpolri`)

- All three are deployed from commit `6dd7712` of this repo (function version 5, since 20:58 UTC: the RAB line ops of M6 and the catalog read). Before that: `833c780`, then `071465e`, which keeps amounts out of write replies for people without money access, then `ba1f40e`, which adds the sign in code check; to roll M6 back, deploy the three from `ba1f40e` again. `team-access` stays deployed from `ba1f40e`. Each function is a one-line entry that imports `https://raw.githubusercontent.com/creativeclubcult/creativeclubcult/<commit>/supabase/functions/<name>/index.ts`; the bundle is built at deploy time, so the code that runs is this folder at that commit. To ship a change, push it, then deploy the same entry with the new commit hash. With the CLI installed, `supabase functions deploy <name> --project-ref zneckeqsvwbavqxpolri --no-verify-jwt` does the same from a checkout.
- Paired with the live Sheet (env `prod`), whose web app runs Sync.gs 1.3.0 (deployment version 3 since 20:53 UTC; before that 1.2.1 as version 2). `admin_origins` is `https://creativeclubcult.com`.
- `GMAIL_APP_PASSWORD` is set, and codes are on (`private.access_rules.two_step`) since 2026-11-05 10:46 UTC. What to do when email stops is in `ops/PRODUCTION.md`.
- Reading and writing are on since 2026-11-05 16:09 UTC: `sheet_values.flags` has `pull_enabled` and `writes_enabled` true, and the live script's `SYNC_WRITES` is `on` (`ops/PRODUCTION.md`, step 9). To pause writing: `syncWritesOff` in the live script and `writes_enabled` false.
- The pg_cron schedules are the same as on DEV.
- `pay-link` and `pay-page` are deployed from commit `56dd5af` (function version 1, since 2026-11-06 18:04 UTC), as the same one-line entries. The database side is `20261106_followups_paylinks.sql`, applied as `followups_paylinks` with all five sections at once (18:01 UTC); its objects equal DEV's. `admin_origins` holds `https://creativeclubcult.com`, so links are `https://creativeclubcult.com/pay#<token>`. No link exists yet: CCC's bank details stay empty until the owner types them in Settings. Rollback, in order: `ops/PRODUCTION.md`, Admin v3.

## Tests

```bash
deno test --no-check --allow-read --allow-env --allow-net=127.0.0.1 supabase/tests/
```

94 tests. `diff_test.ts` (49): diff, commit payloads, HMAC, MD5, and the filter that keeps amounts out of write replies for people without money access. `access_test.ts` (18): codes and their hash, email checks, the message format, a fake SMTP server (sent, refused without leaking the password, too slow), and every team-access action. `ops_test.ts` (9): the RAB line ops (M6), each section's own columns, values the way the Sheet takes them, rows and `expect`, and what a reply commits. `pay_test.ts` (18): tokens and their hash, the limits key, the Indonesian invoice email and the note to the team, an empty Sheet figure never written as Rp 0, and every pay-link and pay-page action and refusal.

Deno is not installed system wide on this machine; a local copy is at `Work CCC/fc-scratch/bin/deno` (gitignored). Node is not installed, so browser scripts are syntax checked with `deno eval --no-check "new Function(Deno.readTextFileSync(f))"`. The Sync.gs end to end harness runs on a synthetic DEV copy in `Work CCC/harness/sync_gs_test.ts`, which stays local. On a DEV copy, `syncDevLineTest` in Sync.gs runs the RAB line checks on a temporary copy of the template.
