// sheets-sync: Sheet → admin pull. Called by pg_cron (x-sync-key, answers 202 at once and works in the
// background) and by the admin's Refresh / Sync now (Bearer JWT of a team member, waits for the result).
// kind 'catalog': Katalog Alat for the RAB gear picker, read live (editors with money access).
import { fromCron, fromUser, hasCronKey } from '../_shared/auth.ts';
import { getState, setState } from '../_shared/db.ts';
import { envMismatch, loadConfig, missingConfig } from '../_shared/env.ts';
import { gate, json, readJson } from '../_shared/http.ts';
import { friendly } from '../_shared/ops.ts';
import { runPull } from '../_shared/pull.ts';
import { callSheet } from '../_shared/sheet.ts';

type EdgeRuntimeLike = { waitUntil(p: Promise<unknown>): void };
const edgeRuntime = (globalThis as unknown as { EdgeRuntime?: EdgeRuntimeLike }).EdgeRuntime;

Deno.serve(async (req) => {
  await loadConfig();
  const early = gate(req);
  if (early) return early;
  const parsed = await readJson(req, 10_000);
  if (!parsed) return json(req, 400, { error: 'Send a JSON body.', code: 'bad_request' });
  const body = parsed.body;

  const cron = hasCronKey(req);
  let canEdit = false;
  let owner = false;
  let money = false;
  let email: string | null = null;
  if (cron) {
    if (!fromCron(req)) return json(req, 401, { error: 'Not allowed.', code: 'bad_key' });
  } else {
    const a = await fromUser(req);
    if (!a.ok) return json(req, a.status, { error: a.error, code: a.code });
    canEdit = a.user.canEdit;
    owner = a.user.owner;
    money = a.user.money;
    email = a.user.email;
  }

  const missing = missingConfig(['webapp', 'secret', 'sheet', 'env']);
  const mismatch = envMismatch();
  if (missing.length || mismatch) {
    return json(req, 503, {
      error: 'The Google Sheet link is not set up yet.', code: 'not_configured',
      ...(owner || cron ? { missing, mismatch } : {}),
    });
  }
  if (body.kind !== undefined && body.kind !== 'pull' && !(body.kind === 'catalog' && !cron)) {
    return json(req, 400, { error: 'Unknown kind.', code: 'bad_request' });
  }
  if (body.kind === 'catalog') {
    if (!canEdit || !money) return json(req, 403, { error: "You don't have access to change money in the Sheet.", code: 'forbidden' });
    const last = await getState<{ at?: string }>('catalog_read');
    if (last?.at && Date.now() - Date.parse(last.at) < 3000) {
      return json(req, 429, { error: 'The equipment list was just read. Try again in a few seconds.', code: 'too_soon' });
    }
    await setState('catalog_read', { at: new Date().toISOString(), by: email });
    const r = await callSheet('catalog', {}, { timeoutMs: 20000 });
    if (!r.ok) return json(req, 502, { error: friendly(r.code, r.message), code: r.code });
    return json(req, 200, { items: Array.isArray(r.data.items) ? r.data.items : [] });
  }
  const tabs = Array.isArray(body.tabs)
    ? body.tabs.filter((g): g is number => Number.isInteger(g) && (g as number) >= 0).slice(0, 20)
    : undefined;

  if (cron) {
    const work = runPull({ trigger: 'cron' }).catch((e) => console.error('cron pull', e));
    if (edgeRuntime) edgeRuntime.waitUntil(work);
    else await work;
    return json(req, 202, { accepted: true });
  }

  // Refresh of given tabs: any team member. A full "Sync now": editors.
  if (!tabs?.length && !canEdit) return json(req, 403, { error: 'Only editors can run a full sync. Use Refresh on a project.', code: 'forbidden' });
  const last = await getState<{ at?: string }>('manual_pull');
  if (last?.at && Date.now() - Date.parse(last.at) < 15000) {
    return json(req, 429, { error: 'A sync just ran. Try again in a few seconds.', code: 'too_soon' });
  }
  await setState('manual_pull', { at: new Date().toISOString(), by: email });
  const out = await runPull({ trigger: 'manual', tabs: tabs?.length ? tabs : 'active' });
  return json(req, out.error ? 502 : 200, out);
});
