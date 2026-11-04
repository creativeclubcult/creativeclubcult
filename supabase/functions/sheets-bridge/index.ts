// sheets-bridge: the fallback path, called only by the Apps Script syncTick (every 10 minutes).
// hello → tells the tick whether to send a snapshot and which waiting ops to run itself;
// snapshot → the same diff + commit as sheets-sync; results → settles ops exactly like sheets-write.
// pair → the one unsigned call: gives Sync.gs the shared secret once it proves it is the deployed web app.
import { fromScript } from '../_shared/auth.ts';
import { getState, q, rpc, select, setIntegration, setState, update } from '../_shared/db.ts';
import { env, envMismatch, forgetConfig, loadConfig, missingConfig } from '../_shared/env.ts';
import { haveDigests, knownGids } from '../_shared/diff.ts';
import { randomHex, safeEqual, sha256Hex } from '../_shared/hmac.ts';
import { json } from '../_shared/http.ts';
import { loadStored, runPull } from '../_shared/pull.ts';
import { askSheet, type SheetResult } from '../_shared/sheet.ts';
import type { Snapshot } from '../_shared/snapshot.ts';
import { settle, type OutboxRow } from '../_shared/write.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/;
const PAIR_TRIES = 5;
const TRANSIENT = new Set(['busy', 'error', 'rate_limited', 'unreachable', 'timeout', 'bad_response']);
const OUTBOX_COLS = 'id,op,target,args,status,attempts,created_by,actor_email,entity_id,forced,via,current,result,last_error,next_attempt_at';

async function flags(): Promise<{ pull_enabled: boolean; writes_enabled: boolean }> {
  const v = (await select<{ value: Record<string, unknown> }>('sheet_values', 'key=eq.flags&select=value'))[0]?.value ?? {};
  return { pull_enabled: v.pull_enabled !== false, writes_enabled: v.writes_enabled === true };
}

async function versionCheck(scriptVersion: string | null) {
  const st = (await select<{ detail: Record<string, unknown> }>('integration_status', 'key=eq.google_sheets&select=detail'))[0];
  const deployed = typeof st?.detail?.webapp_version === 'string' ? st.detail.webapp_version : null;
  if (!scriptVersion || !deployed) return;
  const issue = { kind: 'webapp_version_mismatch', key: 'webapp' };
  const p = scriptVersion === deployed
    ? { seq: 1, kind: 'write', resolved_issue_keys: [issue] }
    : {
      seq: 1, kind: 'write',
      issues: [{
        ...issue, money: false,
        message: 'The Sheet script was updated but not redeployed. Claude needs to redeploy it.',
        detail: { script_version: scriptVersion, webapp_version: deployed },
      }],
    };
  await rpc('sheets_commit', { p });
}

async function hello(req: Request, b: Record<string, unknown>): Promise<Response> {
  const version = typeof b.version === 'string' ? b.version.slice(0, 40) : null;
  const lastError = typeof b.last_error === 'string' ? b.last_error.slice(0, 300) : null;
  await setIntegration({
    last_heartbeat_at: new Date().toISOString(),
    detail: { script_version: version, script_seq: Number.isFinite(b.seq) ? b.seq : null, script_last_error: lastError },
  });
  await versionCheck(version).catch((e) => console.error('version check', e));

  const f = await flags();
  const st = (await select<{ last_success_at: string | null }>('integration_status', 'key=eq.google_sheets&select=last_success_at'))[0];
  const lastOk = st?.last_success_at ? Date.parse(st.last_success_at) : 0;
  const wantSnapshot = f.pull_enabled && Date.now() - lastOk > 5 * 60000;
  const out: Record<string, unknown> = { snapshot: wantSnapshot, ops: [] };
  if (wantSnapshot) {
    const stored = await loadStored();
    out.have = haveDigests(stored);
    out.known_gids = knownGids(stored);
  }
  const pushFailures = (await getState<{ n: number }>('push_failures'))?.n ?? 0;
  if (f.writes_enabled && pushFailures >= 2) {
    const rows = await rpc<OutboxRow[]>('sync_claim', { p_n: 5 });
    if (rows.length) await update('sync_outbox', `id=in.(${rows.map((r) => q(r.id)).join(',')})`, { via: 'bridge' });
    out.ops = rows.map((r) => ({ op_id: r.id, op: r.op, args: r.args, attempt: r.attempts }));
  }
  return json(req, 200, out);
}

async function results(req: Request, b: Record<string, unknown>): Promise<Response> {
  if (!Array.isArray(b.results) || b.results.length > 20) return json(req, 400, { error: 'results must be a list (≤ 20).', code: 'bad_request' });
  const settled: Record<string, string> = {};
  for (const r of b.results as Record<string, unknown>[]) {
    const id = typeof r?.op_id === 'string' && UUID_RE.test(r.op_id) ? r.op_id.toLowerCase() : null;
    if (!id) continue;
    const row = (await select<OutboxRow>('sync_outbox', `id=eq.${q(id)}&select=${OUTBOX_COLS}`))[0];
    if (!row || row.status !== 'sending') { settled[id] = 'ignored'; continue; }
    const code = String(r.code ?? 'error');
    const res: SheetResult = r.ok === true && r.data && typeof r.data === 'object'
      ? { ok: true, data: r.data as Record<string, unknown>, v: null, ms: 0 }
      : {
        ok: false, code, message: String(r.message ?? '').slice(0, 300), current: r.current ?? null,
        transient: TRANSIENT.has(code), v: null, ms: 0,
      };
    const out = await settle(row, res);
    settled[id] = out.status;
  }
  return json(req, 200, { ok: true, settled });
}

/** Pairing: Sync.gs sends a random r; the deployed web app at the configured URL must answer pair_check with
 *  SHA-256(r), which only the script that sent r can do. Then a new shared secret goes to Vault and back to the
 *  script. Only while pairing is open (sync_state 'pairing', opened by the owner), and closed after 5 failed tries. */
async function pair(req: Request, b: Record<string, unknown>): Promise<Response> {
  const missing = missingConfig(['webapp', 'sheet', 'env']);
  if (missing.length || envMismatch()) return json(req, 503, { error: 'The Google Sheet link is not set up yet.', code: 'not_configured' });
  const open = await getState<{ until?: string; fails?: number }>('pairing');
  if (!open?.until || !(Date.parse(open.until) > Date.now())) {
    return json(req, 403, { error: 'Pairing is not open. Open it from the admin first.', code: 'pairing_closed' });
  }
  const r = typeof b.r === 'string' && HEX64.test(b.r) ? b.r : '';
  const check = r && b.sheet === env.sheetId && b.env === env.sheetEnv ? await askSheet('pair_check') : null;
  const h = check?.ok && typeof check.data.h === 'string' ? check.data.h : '';
  if (!r || !safeEqual(h, await sha256Hex(r))) {
    const fails = (open.fails ?? 0) + 1;
    await setState('pairing', { ...open, fails, until: fails >= PAIR_TRIES ? new Date().toISOString() : open.until });
    return json(req, 403, { error: 'The Sheet script could not confirm the pairing.', code: 'pair_failed' });
  }
  const secret = randomHex(32);
  await rpc('sheets_pair_commit', { p_secret: secret }); // stores the secret and closes pairing
  await setState('paired', { at: new Date().toISOString(), sheet: env.sheetId });
  forgetConfig();
  return json(req, 200, { ok: true, secret });
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const b = JSON.parse(raw);
    return b && typeof b === 'object' && !Array.isArray(b) ? b : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.', code: 'method' });
  await loadConfig();
  const raw = await req.text();
  if (raw.length > 5_000_000) return json(req, 413, { error: 'Too large.', code: 'too_large' });
  if (!req.headers.get('x-ccc-time') || !req.headers.get('x-ccc-sig')) {
    const p = raw.length < 2000 ? parseObject(raw) : null;
    if (p?.kind !== 'pair') return json(req, 401, { error: 'Unsigned request.', code: 'unsigned' });
    try {
      return await pair(req, p);
    } catch (e) {
      console.error('sheets-bridge pair', e instanceof Error ? e.message : e);
      return json(req, 500, { error: 'Pairing failed.', code: 'error' });
    }
  }
  const missing = missingConfig(['secret', 'sheet', 'env']);
  if (missing.length) return json(req, 503, { error: 'The Google Sheet link is not set up yet.', code: 'not_configured' });
  const sig = await fromScript(req, raw);
  if (sig !== 'ok') return json(req, 401, { error: 'Bad signature.', code: sig });
  const b = parseObject(raw);
  if (!b) return json(req, 400, { error: 'Send a JSON object.', code: 'bad_request' });
  if (b.sheet !== env.sheetId || (b.env !== undefined && b.env !== env.sheetEnv)) {
    return json(req, 403, { error: 'This Sheet is not paired with this database.', code: 'wrong_sheet' });
  }
  const mismatch = envMismatch();
  if (mismatch) return json(req, 503, { error: mismatch, code: 'not_configured' });

  try {
    switch (b.kind) {
      case 'hello':
        return await hello(req, b);
      case 'snapshot': {
        if (!b.data || typeof b.data !== 'object') return json(req, 400, { error: 'data is missing.', code: 'bad_request' });
        const out = await runPull({ trigger: 'bridge', snapshot: b.data as Snapshot });
        return json(req, out.error ? 502 : 200, { ok: !out.error, ...out });
      }
      case 'results':
        return await results(req, b);
      default:
        return json(req, 400, { error: 'Unknown kind.', code: 'bad_request' });
    }
  } catch (e) {
    console.error('sheets-bridge', e instanceof Error ? e.message : e);
    return json(req, 500, { error: 'The bridge failed.', code: 'error' });
  }
});
