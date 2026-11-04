# Apps Script: Sync.gs deploy runbook

`Sync.gs` is the Sheet side of the admin sync (DESIGN.md §4). It goes into the Apps Script project bound to the Sheet, next to the existing `Code.gs`. It never changes `Code.gs`. It only reuses Code.gs helpers by name (`nextInvoiceNo_`, `pad3_`, `todayText_`, `getOrCreate_`, `cccFolder_`, `equipmentRows_`, `rapikanAlat_`, `clean_`) and its constants.

This folder is server-side code. `.vercelignore` keeps it off the public site, and it holds no secrets. Secrets live only in Script Properties and in Supabase function secrets.

Always deploy to a DEV copy first. Change the live Sheet only when the owner says so.

**Where things live (since 2026-11-04).** All CCC Google work is in hello@creativeclubcult.com.
- The live Sheet is "CCC - RAB & Keuangan" in the Shared Drive "CCC", id `1a5bRCaYtcTrhDyJtpaeCAQeKV58-kvd3NOfuJWGkVtM`.
- Its Drive root "01_CCC - Creative Club Cult" is folder `1pxi6eRLeSV_mKTamNhKZMywMZ2p7z8wZ`. `Code.gs` finds it through `DRIVE_ROOT_ID`, because a folder with the same name still exists in the personal Drive.
- The Sheet that was live before (`1lGOYzhB6TpamLVsf79P3cpLNPHfzFt6W7SeSbdxYZfw`, personal Drive) is an archive. `Sync.gs` and the edge functions refuse it as prod and as dev.

Nobody types or copies the shared secret. The settings go into Vault through the SQL editor, and the secret is created by pairing: Sync.gs asks `sheets-bridge`, which checks back with the web app before it answers (`Work CCC/migrations/20261104_sheets_pairing.sql`).

## 1. DEV copy (do this first)

1. Signed in as hello@, open the live Sheet and choose **File > Make a copy**. Save the copy in My Drive, not in the Shared Drive. The bound script is copied with it. Do not copy the Kas Form.
2. In the copy, open **Extensions > Apps Script**. In `Code.gs`, change only these two lines:
   - `const DRIVE_ROOT = '01_CCC - Creative Club Cult';` → `const DRIVE_ROOT = '99_CCC DEV';`
   - `const DRIVE_ROOT_ID = '1pxi6eRLeSV_mKTamNhKZMywMZ2p7z8wZ';` → `const DRIVE_ROOT_ID = '';`
   Without both changes `syncSetup` and `syncSetupDevCopy` refuse to run, so the copy can never create folders or PDFs in the live Drive tree.
3. Add a script file named `Sync` and paste `ops/apps-script/Sync.gs` into it.
4. Choose **Deploy > New deployment > Web app**, with "Execute as" set to **Me** and "Who has access" set to **Anyone**, and accept the authorization prompt. Copy the `/exec` URL.
   - Access must be "Anyone" because the edge functions call the web app without a Google login.
   - Every request is checked by HMAC, time window, nonce and sheet id, so an unsigned call only ever gets `{ok:false}`. The one unsigned op, `pair_check`, answers only during the two minutes of a pairing that this script started.
5. In the SQL editor of the DEV project (`jvhhcehzhgpcphtpynnx`), store the settings and open pairing:
   ```sql
   select private.sheets_setting('sheets_spreadsheet_id', '<copy id>');
   select private.sheets_setting('sheets_env', 'dev');
   select private.sheets_setting('sheets_webapp_url', 'https://script.google.com/macros/s/<id>/exec');
   select private.sheets_setting('admin_origins', 'http://localhost:*,http://127.0.0.1:*');
   select private.sheets_pairing_open(15);
   ```
6. Within those 15 minutes, run `syncSetupDevCopy` from the editor. It does the following:
   - removes the copied `formKasId`;
   - turns the copied Rekap K folder links into plain text;
   - resets `SYNC_SEQ`;
   - sets `SYNC_SHEET_ID` to the copy's id;
   - pairs with the bridge, which stores the new secret in Vault and in the Script Property `SYNC_SECRET`;
   - sets `SYNC_WRITES=off`;
   - installs the 10-minute `syncTick` trigger.
7. Run `syncSelfTest` and read the log. `ok` must be `true`, and every header, the template anchors, the Code.gs symbols and the mirrors must report `ok` or `true`. A layout error names the cell it expected.
8. Apply `Work CCC/migrations/20261104_admin_ecosystem_schedules.sql` for the pg_cron pulls. It creates the Vault secret `sheets_cron_key`, which `sheets-sync` reads from Vault too.
9. Smoke test:
   - A signed-in owner calls `sheets-sync` with `{}`. Expect `200` and a new `sync_runs` row.
   - Then set `SYNC_WRITES=on` in the copy and change a status from the admin. Expect `200`, and the cell changes in the copy.
   - `sheets-bridge` should start showing `hello` calls every 10 minutes.

Function secrets (`SHEETS_WEBAPP_URL`, `SHEETS_SPREADSHEET_ID`, `SHEETS_ENV`, `ADMIN_ORIGINS`, `SHEETS_SECRET`, `SHEETS_CRON_KEY`) still win over Vault when set, but none are needed.

To pair again later (for example after the database was reset), open pairing as in step 5 and run `syncPair`.

## 2. Live Sheet (only with the owner's go-ahead)

Same steps without the copy, in the live Sheet's own script as hello@. Leave `DRIVE_ROOT` and `DRIVE_ROOT_ID` unchanged, and run `syncSetup` instead of `syncSetupDevCopy`.

- `syncSetup` sets the env to `prod` from the spreadsheet id and stores `SYNC_FORM_ID` from the document property `formKasId`.
- `SYNC_WRITES` stays `off` until the write milestone is signed off.
- The settings go to the PROD project's Vault, with `sheets_env` set to `prod`.
- The edge functions refuse a prod sheet id paired with a dev env, the reverse, and the archived Sheet.

## 3. Updating Sync.gs

1. Paste the new file, then bump `SYNC_VERSION`.
2. Choose **Deploy > Manage deployments > Edit > Version: New version**. This keeps the same `/exec` URL.
3. Run `syncSelfTest`.

The bridge compares the `hello` version with the last version seen through the web app. On a mismatch it opens a `webapp_version_mismatch` issue, which means the trigger code and the deployed web app differ. The next pull after the new version closes it by itself.

A pull reads a RAB tab again only when its cells change (the tab digest covers the cells, not the reading). After an update that changes what is read from a tab, the tabs already in the database keep the old reading until they change. Clear their digests once, then pull:

```sql
update public.sync_state
   set value = (select jsonb_object_agg(k, case when k like 'tab:%' then 'null'::jsonb else v end) from jsonb_each(value) e(k, v))
 where key = 'digests';
```

A pull without tabs reads the active projects only. A done project is read again by a pull for its own tab (`sheets-sync` with `{"tabs": [<gid>]}`).

## 4. Pause or roll back

- **Pause writes:** run `syncWritesOff` from the editor (it sets the Script Property `SYNC_WRITES=off`), or turn writes off from the admin. Two formula-guard trips within 24 hours also set it to off automatically. `syncWritesOn` turns them back on.
- **A formula-guard trip** undoes the change and names what broke, for example `Rekap Project: new errors V9 V10` or `Crew: formulas changed`. The name is in the execution log (`Formula guard: …`) and in the change's `current.broken` in `sync_outbox`. The guard compares the formulas of the whole grid, so a write that only adds a value never trips it.
- **Stop the fallback tick:** run `syncUninstall`. It only removes `syncTick`; `onChangeRab` and `kasDariForm` stay.
- **Roll back code:** in Manage deployments, choose the previous version.
- **Remove completely:** delete the `Sync` file and the web app deployment, then run `syncUninstall` first. `Code.gs` keeps working on its own.

## 5. ALOKASI DANA block (Sync.gs 1.2.0 and later)

The split of the project price sits under the internal summary of every v2 RAB tab, at I40:M49 in the template:

| Row | % (J) | Nominal (L) |
| --- | --- | --- |
| Harga project (Omset) | 100% | `=L33` (Omset: after discount, before PPN) |
| Fee PR / freelance | 5%, typed, may be 0 | `=ROUND(L41*J42;0)` |
| Fee internal (yang bawa project) | 3%, typed, may be 0 | `=ROUND(L41*J43;0)` |
| DANA DIBAGI | 100% | `=L41-L42-L43` |
| Net profit | 10% to 25%, default 25%, validated | `=ROUND(L44*J45;0)` |
| Kas CCC | 5% | `=ROUND(L44*J46;0)` |
| BUDGET PRODUKSI | `=1-J45-J46` | `=L44-L45-L46` |
| Biaya produksi (RAB) | | `=M32` (Total biaya keluar) |
| SISA BUDGET | | `=L47-L48`, red below 0 |

The rows are found by their labels, so the cells above are the template's; a tab with another layout gets the same formulas on its own rows. The admin reads the block into `project_money.rab.internal.alloc` and writes only Net profit (`rab_meta` with `net_profit_pct`, 0.10 to 0.25).

To add it, deploy the web app version first, then run `syncAlokasiSetup` from the editor. It adds the block to `Template RAB` and to every v2 RAB tab that does not have it, and logs one line per tab. It skips a tab whose target rows are not empty, never touches v1 tabs (001 to 009), and running it again changes nothing. In this order the first pull reads every tab with the block; in the other order, clear the digests as in section 3.

The live Sheet got the block on 2026-11-05, before Sync.gs was installed there: a one-off script file with the same steps was added, run and deleted again. It sits at I40:M49 in `Template RAB`, 010, 011 and 012; every cell outside the block was unchanged. Once Sync.gs is live, `syncAlokasiSetup` reports `already there` for those tabs.

## 6. Local test harness (no Google account needed)

`Work CCC/harness/` is gitignored. It holds:
- `gas_mock.ts`: a small in-memory Apps Script runtime;
- `workbook.ts`: a synthetic workbook copied from the live layout;
- `sync_gs_test.ts`;
- `env_test.ts`: the Sheet and environment lock of the edge functions;
- `Code.recovered.gs`: the recovered Code.gs.

The test loads `Code.gs` and `Sync.gs` in one shared scope, the way Apps Script does, and runs every op through `doPost` with requests signed by `supabase/functions/_shared/hmac.ts`. It also feeds the snapshot through `diff.ts`.

```
deno test --allow-read --allow-env "Work CCC/harness/sync_gs_test.ts" "Work CCC/harness/env_test.ts"
deno test --no-check --allow-read --allow-env supabase/tests/diff_test.ts
```

The mock does not prove Google-side behaviour such as protections, the PDF export, DriveApp, FormApp, quotas or locks under real concurrency. Run step 6 and the smoke test on the DEV copy before trusting a change.
