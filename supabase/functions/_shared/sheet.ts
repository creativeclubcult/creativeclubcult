// callSheet: one signed POST to the Apps Script web app (Sync.gs doPost).
// Google answers a web-app POST with 302 to a googleusercontent echo URL; fetch follows it as a GET.
import { env } from './env.ts';
import { signRequest } from './hmac.ts';

export type SheetOk = { ok: true; data: Record<string, unknown>; v: string | null; ms: number };
export type SheetFail = {
  ok: false; code: string; message: string; current: unknown; transient: boolean; v: string | null; ms: number;
};
export type SheetResult = SheetOk | SheetFail;

// codes the Apps Script returns that mean "try again later"
const TRANSIENT = new Set(['busy', 'error', 'rate_limited', 'unreachable', 'timeout', 'bad_response']);

function fail(code: string, message: string, ms: number, v: string | null = null, current: unknown = null): SheetFail {
  if (code === 'error' && /too many times|quota|rate limit|Service invoked/i.test(message)) code = 'rate_limited';
  return { ok: false, code, message: message.slice(0, 300), current, transient: TRANSIENT.has(code), v, ms };
}

export async function callSheet(
  op: string,
  args: unknown,
  o: { key?: string; attempt?: number; timeoutMs?: number } = {},
): Promise<SheetResult> {
  const body = await signRequest(env.secret, { sheet: env.sheetId, op, key: o.key ?? '', attempt: o.attempt ?? 1, args });
  return await post(body, o.timeoutMs ?? 25000);
}

/** The one unsigned call, for pairing: Sync.gs answers it only while its syncPair_ waits for the bridge. */
export function askSheet(op: 'pair_check'): Promise<SheetResult> {
  return post({ v: 1, op }, 15000);
}

async function post(body: unknown, timeoutMs: number): Promise<SheetResult> {
  const t0 = Date.now();
  let res: Response;
  try {
    res = await fetch(env.webappUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // a "simple" body: Apps Script reads e.postData.contents
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const name = (e as Error).name;
    if (name === 'TimeoutError' || name === 'AbortError') return fail('timeout', 'The Sheet did not answer in time.', Date.now() - t0);
    return fail('unreachable', 'The Sheet could not be reached.', Date.now() - t0);
  }
  const ms = Date.now() - t0;
  const raw = await res.text().catch(() => '');
  if (res.status === 429) return fail('rate_limited', 'Google is limiting requests.', ms);
  if (res.status >= 500) return fail('unreachable', `Google answered ${res.status}.`, ms);
  if (!res.ok) return fail('bad_response', `Google answered ${res.status}.`, ms);
  let out: { ok?: boolean; data?: Record<string, unknown>; code?: string; message?: string; current?: unknown; v?: string };
  try {
    out = JSON.parse(raw);
  } catch {
    const hint = /accounts\.google\.com|Sign in|ServiceLogin/i.test(raw) ? ' (the web app asks for a Google sign-in: check "Who has access")' : '';
    return fail('bad_response', 'The Sheet answered with something that is not JSON' + hint + '.', ms);
  }
  const v = typeof out.v === 'string' ? out.v : null;
  if (out.ok === true && out.data && typeof out.data === 'object') return { ok: true, data: out.data, v, ms };
  if (out.ok === false) return fail(String(out.code || 'error'), String(out.message || 'The Sheet refused the change.'), ms, v, out.current ?? null);
  return fail('bad_response', 'The Sheet answered in an unknown format.', ms, v);
}
