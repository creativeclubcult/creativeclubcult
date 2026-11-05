// sheets-write: admin → Sheet write-through (§3.5). The admin sends {op_id, op, args} with the user's JWT.
// The op is recorded in sync_outbox, sent to the Apps Script web app, and the Sheet's reply is committed.
import { fromUser, type TeamUser } from '../_shared/auth.ts';
import { DbError, getState, insert, q, select, setState, update } from '../_shared/db.ts';
import { envMismatch, loadConfig, missingConfig } from '../_shared/env.ts';
import { gate, json, readJson } from '../_shared/http.ts';
import { CONTROL_OPS, friendly, OPS, withoutMoney } from '../_shared/ops.ts';
import { runPull } from '../_shared/pull.ts';
import { deliver, type OutboxRow } from '../_shared/write.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTBOX_COLS = 'id,op,target,args,status,attempts,created_by,actor_email,entity_id,forced,via,current,result,last_error,next_attempt_at';

async function getOp(id: string): Promise<OutboxRow | null> {
  return (await select<OutboxRow>('sync_outbox', `id=eq.${q(id)}&select=${OUTBOX_COLS}`))[0] ?? null;
}

/** The answer for an op that already exists (the admin's "Try again" re-sends the same op_id). */
function stateBody(r: OutboxRow): { http: number; body: Record<string, unknown> } {
  switch (r.status) {
    case 'done': return { http: 200, body: { ok: true, op_id: r.id, ...(r.result as Record<string, unknown> ?? {}) } };
    case 'pending':
    case 'sending': return { http: 202, body: { queued: true, op_id: r.id, retry_at: r.next_attempt_at ?? null } };
    case 'conflict': return { http: 409, body: { conflict: true, op_id: r.id, current: r.current ?? null } };
    case 'needs_confirm': return { http: 409, body: { needs_confirm: true, op_id: r.id, detail: r.current ?? null, error: r.last_error } };
    case 'discarded': return { http: 410, body: { discarded: true, op_id: r.id } };
    default: return { http: 422, body: { error: r.last_error ?? 'The Sheet refused the change.', op_id: r.id } };
  }
}

/** Every answer that can carry the Sheet's record goes out through here: without money access, no amounts. */
function answer(req: Request, user: TeamUser, http: number, body: Record<string, unknown>): Response {
  const rec = body.record;
  if (user.money || !rec || typeof rec !== 'object') return json(req, http, body);
  return json(req, http, { ...body, record: withoutMoney(rec as Record<string, unknown>) });
}

function mayControl(user: TeamUser, row: OutboxRow): string | null {
  if (!user.canEdit) return 'Your role can view but not change the Sheet.';
  if (row.created_by !== user.id && !user.owner) return 'Only the person who made this change, or the owner, can do that.';
  const def = OPS[row.op];
  if (def?.perm === 'owner' && !user.owner) return 'Only the owner can do that.';
  return null;
}

async function writesEnabled(): Promise<boolean> {
  const v = (await select<{ value: Record<string, unknown> }>('sheet_values', 'key=eq.flags&select=value'))[0]?.value;
  return v?.writes_enabled === true;
}

async function resend(req: Request, user: TeamUser, row: OutboxRow, patch: Record<string, unknown>): Promise<Response> {
  try {
    await update('sync_outbox', `id=eq.${q(row.id)}`, { status: 'sending', attempts: 1, next_attempt_at: new Date().toISOString(), ...patch });
  } catch (e) {
    if (e instanceof DbError && e.code === '23505') return json(req, 409, { waiting: true, error: 'Another change to this record is still waiting for the Sheet.' });
    throw e;
  }
  const fresh = (await getOp(row.id))!;
  const out = await deliver(fresh);
  return answer(req, user, out.http, out.body);
}

async function resolveIssue(id: string, user: TeamUser, resolution: string) {
  await update('sync_issues', `id=eq.${q(id)}&resolved_at=is.null`, { resolved_at: new Date().toISOString(), resolution, resolved_by: user.id });
}

async function control(req: Request, user: TeamUser, op: string, a: Record<string, unknown>, opId: string): Promise<Response> {
  if (op === 'issue_action') {
    const iid = typeof a.issue_id === 'string' && UUID_RE.test(a.issue_id) ? a.issue_id : null;
    if (!iid) return json(req, 422, { error: 'Pick an issue.', code: 'invalid' });
    const issue = (await select<{ id: string; kind: string; key: string; detail: Record<string, unknown>; money: boolean; resolved_at: string | null }>(
      'sync_issues', `id=eq.${q(iid)}&select=id,kind,key,detail,money,resolved_at`,
    ))[0];
    if (!issue || issue.resolved_at) return json(req, 404, { error: 'This issue is already settled.', code: 'not_found' });
    if (!user.canEdit) return json(req, 403, { error: 'Your role can view but not change the Sheet.', code: 'forbidden' });
    if (issue.money && !user.money) return json(req, 403, { error: "You don't have access to money in the Sheet.", code: 'forbidden' });
    const action = String(a.action ?? '');
    if (action === 'ignore') {
      await resolveIssue(iid, user, 'ignored');
      return json(req, 200, { ok: true });
    }
    if (action === 'add_to_kas' && issue.kind === 'form_entry_missing') {
      if (!(await writesEnabled())) return json(req, 423, { paused: true, error: friendly('writes_off') });
      const row = { ...(issue.detail.row as Record<string, unknown>), note: 'via Form' };
      const c = OPS.kas_add.check({ row }, opId);
      if (!c.ok) return json(req, 422, { error: c.error, code: c.code });
      const ins = await insert<OutboxRow>('sync_outbox', {
        id: opId, created_by: user.id, actor_email: user.email, op: 'kas_add', target: c.target, args: c.args,
        status: 'sending', attempts: 1, via: 'push',
      }, `select=${OUTBOX_COLS}`);
      const out = await deliver(ins);
      if (out.status === 'done') await resolveIssue(iid, user, 'added');
      return answer(req, user, out.http, out.body);
    }
    if (action === 'confirm' && issue.kind === 'mass_change') {
      await setState('force_removals', { until: new Date(Date.now() + 15 * 60000).toISOString(), by: user.email });
      const dig = (await getState<Record<string, string | null>>('digests')) ?? {};
      await setState('digests', { ...dig, kas: null, rekap: null });
      const out = await runPull({ trigger: 'manual', tabs: 'active' });
      return json(req, out.error ? 502 : 200, { ok: !out.error, ...out });
    }
    if (action === 'move_links' && issue.kind === 'client_code_changed') {
      const from = issue.detail.from_id, to = issue.detail.to_id;
      if (typeof from !== 'string' || typeof to !== 'string') return json(req, 422, { error: 'This issue has no clients to move.', code: 'invalid' });
      await update('documents', `client_id=eq.${q(from)}`, { client_id: to });
      await update('projects', `plan_client_id=eq.${q(from)}`, { plan_client_id: to });
      await resolveIssue(iid, user, 'moved');
      return json(req, 200, { ok: true });
    }
    return json(req, 422, { error: "That action doesn't fit this issue.", code: 'invalid' });
  }

  const target = typeof a.op_id === 'string' && UUID_RE.test(a.op_id) ? a.op_id : null;
  if (!target) return json(req, 422, { error: 'Pick a change.', code: 'invalid' });
  const row = await getOp(target);
  if (!row) return json(req, 404, { error: 'This change is no longer listed.', code: 'not_found' });
  const denied = mayControl(user, row);
  if (denied) return json(req, 403, { error: denied, code: 'forbidden' });
  if (op === 'outbox_discard') {
    if (row.status === 'done' || row.status === 'discarded') return json(req, 409, { error: 'This change is already settled.', code: 'settled' });
    if (row.status === 'sending') return json(req, 409, { error: 'This change is being sent right now. Try again in a moment.', code: 'sending' });
    await update('sync_outbox', `id=eq.${q(row.id)}`, { status: 'discarded', last_error: `Discarded by ${user.email ?? 'a team member'}` });
    return json(req, 200, { ok: true, discarded: true, op_id: row.id });
  }
  if (!(await writesEnabled())) return json(req, 423, { paused: true, error: friendly('writes_off') });
  if (op === 'outbox_retry') {
    if (row.status !== 'pending' && row.status !== 'failed') return json(req, 409, { error: 'This change is not waiting.', code: 'settled' });
    return await resend(req, user, row, {});
  }
  if (op === 'outbox_force') {
    if (row.status !== 'conflict') return json(req, 409, { error: 'Only a change that conflicts with the Sheet can be forced.', code: 'settled' });
    return await resend(req, user, row, { args: { ...row.args, force: true }, forced: true });
  }
  return json(req, 422, { error: 'Unknown action.', code: 'invalid' });
}

Deno.serve(async (req) => {
  await loadConfig();
  const early = gate(req);
  if (early) return early;
  const a = await fromUser(req);
  if (!a.ok) return json(req, a.status, { error: a.error, code: a.code });
  const user = a.user;
  const parsed = await readJson(req, 200_000);
  if (!parsed) return json(req, 400, { error: 'Send a JSON body.', code: 'bad_request' });
  const missing = missingConfig(['webapp', 'secret', 'sheet', 'env']);
  const mismatch = envMismatch();
  if (missing.length || mismatch) {
    return json(req, 503, { error: 'The Google Sheet link is not set up yet.', code: 'not_configured', ...(user.owner ? { missing, mismatch } : {}) });
  }

  const { op_id: opId, op } = parsed.body as { op_id?: unknown; op?: unknown };
  const args = (parsed.body.args ?? {}) as Record<string, unknown>;
  if (typeof opId !== 'string' || !UUID_RE.test(opId)) return json(req, 400, { error: 'op_id must be a uuid.', code: 'bad_request' });
  if (typeof op !== 'string') return json(req, 400, { error: 'op is missing.', code: 'bad_request' });
  if (typeof args !== 'object' || Array.isArray(args)) return json(req, 400, { error: 'args must be an object.', code: 'bad_request' });

  try {
    if (CONTROL_OPS.includes(op)) return await control(req, user, op, args, opId.toLowerCase());
    const def = OPS[op];
    if (!def) return json(req, 422, { error: 'Unknown change.', code: 'invalid' });
    if (!def.enabled) return json(req, 422, { error: friendly('not_enabled'), code: 'not_enabled' });
    if (!user.canEdit) return json(req, 403, { error: 'Your role can view but not change the Sheet.', code: 'forbidden' });
    if (def.perm === 'owner' && !user.owner) return json(req, 403, { error: 'Only the owner can delete cash entries.', code: 'forbidden' });
    const c = def.check(args, opId.toLowerCase());
    if (!c.ok) return json(req, c.status ?? 422, { error: c.error, code: c.code });
    if (c.money && !user.money) return json(req, 403, { error: "You don't have access to change money in the Sheet.", code: 'forbidden' });

    const existing = await getOp(opId);
    if (existing) {
      if (existing.created_by !== user.id && !user.owner) return json(req, 403, { error: 'This change belongs to someone else.', code: 'forbidden' });
      const s = stateBody(existing);
      return answer(req, user, s.http, s.body);
    }
    if (!(await writesEnabled())) return json(req, 423, { paused: true, error: friendly('writes_off') });
    const since = new Date(Date.now() - 60000).toISOString();
    const recent = await select('sync_outbox', `created_by=eq.${q(user.id)}&created_at=gte.${q(since)}&select=id&limit=31`);
    if (recent.length >= 30) return json(req, 429, { error: 'Too many changes in a minute. Wait a moment.', code: 'too_many' });

    if (c.projectId) {
      const pr = (await select<{ sheet_gid: number | null; sheet_state: string; seq: number | null }>(
        'projects', `id=eq.${q(c.projectId)}&select=sheet_gid,sheet_state,seq`,
      ))[0];
      if (!pr) return json(req, 422, { error: 'This project no longer exists.', code: 'not_found' });
      if (op === 'create_rab') {
        if (pr.sheet_state !== 'none') return json(req, 422, { error: 'This project already has a RAB.', code: 'invalid' });
      } else {
        if (pr.sheet_state !== 'present' || pr.sheet_gid === null) return json(req, 422, { error: friendly('not_found'), code: 'not_found' });
        // the old RABs 001 to 009 stay as they are (the admin shows them read only; this holds without the admin too)
        if (pr.seq !== null && pr.seq <= 9) return json(req, 422, { error: 'An old RAB (001 to 009): change it in the Sheet.', code: 'frozen' });
        c.args.tab_gid = Number(pr.sheet_gid);
      }
    }

    let row: OutboxRow;
    try {
      row = await insert<OutboxRow>('sync_outbox', {
        id: opId.toLowerCase(), created_by: user.id, actor_email: user.email, op, target: c.target,
        entity_id: c.projectId ?? null, args: c.args, status: 'sending', attempts: 1, via: 'push', forced: args.force === true,
      }, `select=${OUTBOX_COLS}`);
    } catch (e) {
      if (e instanceof DbError && e.code === '23505') {
        if (/one_active_per_target/.test(e.message + (e.details ?? ''))) {
          const active = (await select<{ id: string }>('sync_outbox', `target=eq.${q(c.target)}&status=in.(pending,sending)&select=id`))[0];
          return json(req, 409, { waiting: true, op_id: active?.id ?? null, error: 'Another change to this record is still waiting for the Sheet.' });
        }
        const again = await getOp(opId);
        if (again) { const s = stateBody(again); return answer(req, user, s.http, s.body); }
      }
      throw e;
    }
    const out = await deliver(row);
    return answer(req, user, out.http, out.body);
  } catch (e) {
    console.error('sheets-write', e instanceof Error ? e.message : e);
    return json(req, 500, { error: 'Something went wrong while saving. Nothing was lost; try again.', code: 'error' });
  }
});
