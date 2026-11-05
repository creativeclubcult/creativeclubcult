// Delivering one sync_outbox op to the Sheet and settling it (push, retry inside a pull, or the bridge tick).
import { buildWriteCommit, type WriteReply } from './diff.ts';
import { DbError, getState, insert, q, rpc, select, setState, update, upsert } from './db.ts';
import { friendly, withoutMoney } from './ops.ts';
import { callSheet, type SheetResult } from './sheet.ts';

export interface OutboxRow {
  id: string; op: string; target: string; args: Record<string, unknown>; status: string; attempts: number;
  created_by: string | null; actor_email: string | null; entity_id: string | null; forced: boolean; via: string;
  current?: unknown; result?: unknown; last_error?: string | null; next_attempt_at?: string;
}

export interface Outcome {
  status: 'done' | 'pending' | 'conflict' | 'needs_confirm' | 'failed';
  http: number;
  body: Record<string, unknown>;
}

const BACKOFF_MIN = [1, 2, 5, 10, 30, 60];
const MAX_ATTEMPTS = 6;
const PUSH_FAIL_CODES = new Set(['unreachable', 'timeout', 'bad_response']);

async function setOutbox(id: string, patch: Record<string, unknown>) {
  await update('sync_outbox', `id=eq.${q(id)}`, patch);
}

async function pushFailures(failed: boolean) {
  const cur = (await getState<{ n: number }>('push_failures'))?.n ?? 0;
  const n = failed ? cur + 1 : 0;
  if (n !== cur) await setState('push_failures', { n, at: new Date().toISOString() });
}

export async function noteRateLimit() {
  const b = await getState<{ level?: number; until?: string }>('backoff');
  const level = Math.min((b?.level ?? 0) + 1, 3);
  const mins = [2, 5, 15][level - 1];
  await setState('backoff', { level, until: new Date(Date.now() + mins * 60000).toISOString() });
}

/** Apply the Sheet's answer to an outbox row. Used for every path, so results are settled the same way. */
export async function settle(row: OutboxRow, res: SheetResult): Promise<Outcome> {
  if (res.ok) {
    await pushFailures(false);
    const data = res.data as WriteReply & { seq?: number };
    const seq = Number(data.seq);
    let commit: unknown = null;
    if (Number.isInteger(seq) && seq > 0) {
      const p = buildWriteCommit(data, {
        op: row.op, seq, actor_id: row.created_by, actor_email: row.actor_email, outbox_id: row.id, forced: row.forced,
        project_id: (row.args.project_id as string) ?? null, tab_gid: (row.args.tab_gid as number) ?? null,
      });
      commit = await rpc('sheets_commit', { p });
    }
    if (row.op === 'export_pdf') await recordPdf(row, data).catch((e) => console.error('documents upsert', e));
    const record = pickRecord(data);
    // whoever made the change can read this row later, with or without money access
    await setOutbox(row.id, { status: 'done', result: { record: withoutMoney(record), seq: data.seq ?? null, commit }, last_error: null, current: null });
    return { status: 'done', http: 200, body: { ok: true, op_id: row.id, record, seq: data.seq ?? null } };
  }

  if (res.code === 'rate_limited') await noteRateLimit();
  if (res.transient) {
    await pushFailures(PUSH_FAIL_CODES.has(res.code));
    if (row.attempts >= MAX_ATTEMPTS) {
      await setOutbox(row.id, { status: 'failed', last_error: friendly(res.code, res.message) });
      return { status: 'failed', http: 422, body: { error: "The Sheet couldn't be reached after several tries. Try again later.", code: res.code, op_id: row.id } };
    }
    const wait = BACKOFF_MIN[Math.max(0, Math.min(row.attempts, BACKOFF_MIN.length) - 1)];
    const at = new Date(Date.now() + wait * 60000).toISOString();
    await setOutbox(row.id, { status: 'pending', next_attempt_at: at, last_error: friendly(res.code, res.message) });
    return { status: 'pending', http: 202, body: { queued: true, op_id: row.id, retry_at: at, reason: res.code } };
  }

  await pushFailures(false);
  if (res.code === 'conflict') {
    const cur = (res.current ?? {}) as { field?: string; sheet_value?: unknown; you_saw?: unknown };
    const current = cur.field ? { [cur.field]: cur.sheet_value } : cur;
    await setOutbox(row.id, { status: 'conflict', current: res.current, last_error: friendly('conflict') });
    return { status: 'conflict', http: 409, body: { conflict: true, op_id: row.id, fields: cur.field ? [cur.field] : [], current } };
  }
  if (res.code === 'duplicate') {
    await setOutbox(row.id, { status: 'needs_confirm', current: res.current, last_error: res.message });
    return { status: 'needs_confirm', http: 409, body: { duplicate: true, op_id: row.id, row: res.current, error: res.message } };
  }
  if (res.code === 'needs_confirm') {
    await setOutbox(row.id, { status: 'needs_confirm', current: res.current, last_error: res.message });
    return { status: 'needs_confirm', http: 409, body: { needs_confirm: true, op_id: row.id, detail: res.current, error: res.message } };
  }
  // a moved Rekap row comes back whole (amounts included); its money issue keeps the detail, the outbox row doesn't
  const keep = res.code === 'write_landed_on_moved_row' ? null : res.current ?? null;
  await setOutbox(row.id, { status: 'failed', last_error: friendly(res.code, res.message), current: keep });
  if (res.code === 'formula_guard') await openIssue('formula_guard', row.id, friendly('formula_guard'), { op: row.op, message: res.message }, false);
  if (res.code === 'write_landed_on_moved_row') await openIssue('write_landed_on_moved_row', row.id, res.message, { op: row.op, detail: res.current }, true);
  if (res.code === 'writes_off') return { status: 'failed', http: 423, body: { paused: true, op_id: row.id, error: friendly('writes_off') } };
  return { status: 'failed', http: 422, body: { error: friendly(res.code, res.message), code: res.code, op_id: row.id } };
}

function pickRecord(d: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of ['project', 'rab', 'kas', 'client', 'crew', 'file', 'tab', 'written', 'noop', 'locked', 'replayed', 'invoice_no', 'doc_type', 'folder_url', 'removed', 'row', 'inserted']) {
    if (d[k] !== undefined) out[k] = d[k];
  }
  return out;
}

async function openIssue(kind: string, key: string, message: string, detail: Record<string, unknown>, money: boolean) {
  await rpc('sheets_commit', { p: { seq: 1, kind: 'write', issues: [{ kind, key, message, detail, money }] } }).catch((e) => console.error('issue', e));
}

async function recordPdf(row: OutboxRow, d: Record<string, unknown>) {
  const f = d.file as { id?: string; url?: string; name?: string; created?: string } | undefined;
  if (!f?.id || !f.url) return;
  const pid = typeof row.args.project_id === 'string' ? row.args.project_id : null;
  let clientId: string | null = null;
  if (pid) clientId = (await select<{ client_id: string | null }>('projects', `id=eq.${q(pid)}&select=client_id`))[0]?.client_id ?? null;
  const kind = String(d.doc_type ?? 'INVOICE').toLowerCase();
  const docs = await upsert<{ id: string }>('documents', [{
    drive_file_id: f.id, url: f.url, title: String(f.name ?? 'PDF').replace(/\.pdf$/i, '').slice(0, 200),
    kind: ['penawaran', 'invoice', 'kwitansi'].includes(kind) ? kind : 'other', doc_no: d.invoice_no ?? null,
    project_id: pid, client_id: clientId, source: 'admin-export', file_created_at: f.created ?? new Date().toISOString(),
  }], 'drive_file_id');
  if (docs[0]) {
    await insert('activity_log', {
      actor_id: row.created_by, actor_email: row.actor_email, action: 'made a PDF', entity: 'document',
      entity_id: docs[0].id, label: String(f.name ?? '').slice(0, 200), source: 'admin',
    });
  }
}

/** Send one op (row must already be in status 'sending' with attempts counted) and settle it. */
export async function deliver(row: OutboxRow, timeoutMs = 25000): Promise<Outcome> {
  const res = await callSheet(row.op, row.args, { key: row.id, attempt: Math.max(1, row.attempts), timeoutMs });
  try {
    return await settle(row, res);
  } catch (e) {
    // the Sheet accepted the change but the mirror commit failed: keep the op, the next pull brings the values
    const msg = e instanceof DbError ? e.message : String(e);
    console.error('settle failed', row.id, msg);
    if (res.ok) {
      await setOutbox(row.id, { status: 'done', result: { error: 'mirror_commit_failed', message: msg.slice(0, 300) } }).catch(() => {});
      return { status: 'done', http: 200, body: { ok: true, op_id: row.id, record: null, note: 'Saved to the Sheet; the admin catches up on the next sync.' } };
    }
    throw e;
  }
}

/** Retry due ops inside a pull: ≤ n ops, FIFO, one per target (sync_claim), within a time budget. */
export async function retryDue(n: number, budgetMs: number): Promise<{ tried: number; done: number }> {
  const t0 = Date.now();
  const rows = await rpc<OutboxRow[]>('sync_claim', { p_n: n });
  let done = 0;
  for (const row of rows) {
    if (Date.now() - t0 > budgetMs) {
      await setOutbox(row.id, { status: 'pending', next_attempt_at: new Date().toISOString(), attempts: Math.max(0, row.attempts - 1) });
      continue;
    }
    const out = await deliver(row, Math.min(25000, Math.max(5000, budgetMs - (Date.now() - t0))));
    if (out.status === 'done') done++;
  }
  return { tried: rows.length, done };
}
