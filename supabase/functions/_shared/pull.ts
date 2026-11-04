// One Sheet → admin run (§3.4.2): lease, switches, due retries, snapshot, diff, one-transaction commit, status.
import { buildSnapshotCommit, haveDigests, knownGids, type Stored } from './diff.ts';
import { getState, insert, q, rpc, select, selectAll, setIntegration, setState, update } from './db.ts';
import { env } from './env.ts';
import { friendly } from './ops.ts';
import { callSheet } from './sheet.ts';
import type { Snapshot } from './snapshot.ts';
import { noteRateLimit, retryDue } from './write.ts';

export interface PullOptions {
  trigger: 'cron' | 'manual' | 'bridge';
  tabs?: number[] | 'active' | 'all';
  snapshot?: Snapshot; // given by the bridge (the Apps Script tick read it itself)
  webappVersion?: string | null;
}

interface RunState { n: number; last_form_check?: string | null; failures?: number }

export async function loadStored(): Promise<Stored> {
  const state = await select<{ key: string; value: Record<string, unknown> }>(
    'sync_state', `key=in.(${['digests', 'last_snapshot_seq'].map(q).join(',')})&select=key,value`,
  );
  const st = Object.fromEntries(state.map((r) => [r.key, r.value]));
  const [projects, kas, issues, values] = await Promise.all([
    selectAll<Stored['projects'][number]>('projects', 'sheet_gid=not.is.null&select=id,sheet_gid,tab_name,seq,sheet_state,sheet_seq&order=id'),
    selectAll<Stored['kas'][number]>('kas_entries', 'sheet_state=eq.present&select=id,sheet_row,row_hash,sheet_seq&order=id'),
    selectAll<Stored['open_issues'][number]>('sync_issues', 'resolved_at=is.null&select=kind,key,detail&order=id'),
    select<{ key: string; value: unknown }>('sheet_values', 'key=in.(meta,labels)&select=key,value'),
  ]);
  const last = st.last_snapshot_seq?.seq;
  return {
    last_snapshot_seq: typeof last === 'number' ? last : null,
    digests: (st.digests ?? {}) as Record<string, string | null>,
    projects, kas, open_issues: issues,
    values: Object.fromEntries(values.map((v) => [v.key, v.value])),
  };
}

async function flags(): Promise<{ pull_enabled: boolean; writes_enabled: boolean }> {
  const v = (await select<{ value: Record<string, unknown> }>('sheet_values', 'key=eq.flags&select=value'))[0]?.value ?? {};
  return { pull_enabled: v.pull_enabled !== false, writes_enabled: v.writes_enabled === true };
}

async function recentKasAdd(): Promise<boolean> {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const rows = await select('sync_outbox', `op=eq.kas_add&created_at=gte.${q(since)}&select=id&limit=1`);
  return rows.length > 0;
}

async function failRun(trigger: string, message: string, sheetMs: number | null, t0: number) {
  await insert('sync_runs', {
    trigger, ok: false, error: message.slice(0, 500), sheet_ms: sheetMs, total_ms: Date.now() - t0, finished_at: new Date().toISOString(),
  }).catch((e) => console.error('sync_runs', e));
  const rs = (await getState<RunState>('run')) ?? { n: 0 };
  await setState('run', { ...rs, failures: (rs.failures ?? 0) + 1 });
  await setIntegration({ status: 'error', last_error: message }).catch((e) => console.error('integration', e));
}

export async function runPull(o: PullOptions): Promise<Record<string, unknown>> {
  const t0 = Date.now();
  const holder = `${o.trigger}:${crypto.randomUUID()}`;
  if (!(await rpc<boolean>('sync_lease', { p_holder: holder, p_seconds: 90 }))) return { skipped: 'busy' };
  try {
    const f = await flags();
    if (!f.pull_enabled) return { skipped: 'paused' };
    const backoff = await getState<{ until?: string }>('backoff');
    if (backoff?.until && Date.parse(backoff.until) > Date.now()) return { skipped: 'backoff', until: backoff.until };

    let retried: { tried: number; done: number } | null = null;
    if (!o.snapshot && f.writes_enabled) retried = await retryDue(5, 40000).catch((e) => { console.error('retry', e); return null; });

    const stored = await loadStored();
    const rs = (await getState<RunState>('run')) ?? { n: 0 };
    const n = rs.n + 1;
    let snap = o.snapshot;
    let sheetMs: number | null = null;
    let version = o.webappVersion ?? null;
    let formCheck = false;
    if (!snap) {
      const tabs = o.tabs ?? (n % 5 === 0 || !stored.digests.rekap ? 'active' : 'none');
      const lastCheck = rs.last_form_check ? Date.parse(rs.last_form_check) : 0;
      formCheck = env.sheetEnv === 'prod' && (Date.now() - lastCheck > 30 * 60000 || await recentKasAdd());
      const res = await callSheet('snapshot', {
        have: haveDigests(stored), known_gids: knownGids(stored), tabs, form_check: formCheck,
      }, { timeoutMs: 25000 });
      sheetMs = res.ms;
      if (!res.ok) {
        if (res.code === 'rate_limited') await noteRateLimit();
        if (res.code === 'busy') return { skipped: 'busy' };
        await failRun(o.trigger, friendly(res.code, res.message), sheetMs, t0);
        return { error: friendly(res.code, res.message), code: res.code };
      }
      snap = res.data as unknown as Snapshot;
      version = res.v;
    }

    const force = await getState<{ until?: string }>('force_removals');
    const built = buildSnapshotCommit(snap, stored, {
      trigger: o.trigger, force_removals: !!force?.until && Date.parse(force.until) > Date.now(),
      expect_sheet: env.sheetId, expect_env: env.sheetEnv,
    });
    if (built.skip === 'busy') return { skipped: 'busy' };
    if (built.skip === 'wrong_sheet') {
      await failRun(o.trigger, friendly('wrong_sheet'), sheetMs, t0);
      return { error: friendly('wrong_sheet'), code: 'wrong_sheet' };
    }
    let commit: Record<string, unknown> | null = null;
    if (!built.skip) commit = await rpc<Record<string, unknown>>('sheets_commit', { p: built.payload });

    await setState('run', { n, last_form_check: formCheck ? new Date().toISOString() : rs.last_form_check ?? null, failures: 0 });
    const changed = commit?.changed === true;
    const detail: Record<string, unknown> = {
      seq: snap.meta?.seq ?? null, env: env.sheetEnv, sheet_ms: sheetMs, total_ms: Date.now() - t0,
      last_run: { trigger: o.trigger, skip: built.skip ?? null, at: new Date().toISOString() },
    };
    if (!o.snapshot && version) detail.webapp_version = version; // the deployed web app's SYNC_VERSION
    if (changed) { detail.changed_at = new Date().toISOString(); detail.counts = commit?.counts ?? null; }
    await setIntegration({ status: 'connected', last_error: null, last_success_at: new Date().toISOString(), detail });
    if (typeof commit?.run_id === 'number') {
      await update('sync_runs', `id=eq.${commit.run_id}`, {
        finished_at: new Date().toISOString(), sheet_ms: sheetMs, total_ms: Date.now() - t0,
        warnings: built.warnings,
      }).catch((e) => console.error('sync_runs', e));
    }
    return {
      run_id: commit?.run_id ?? null, changed: commit?.counts ?? null, skipped: built.skip === 'idle' ? undefined : built.skip,
      idle: built.skip === 'idle', stale: built.skip === 'stale', issues: (commit?.issues as Record<string, unknown>)?.open ?? null,
      retried, plan: { gone: built.plan.projects.gone, mass_change: built.plan.mass_change, kas: built.plan.kas },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('pull failed', msg);
    await failRun(o.trigger, 'Sync run failed: ' + msg, null, t0).catch(() => {});
    return { error: 'The sync run failed. It is retried next minute.', code: 'error' };
  } finally {
    await rpc('sync_lease', { p_holder: holder, p_seconds: 0 }).catch(() => {});
  }
}
