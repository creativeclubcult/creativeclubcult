// team-access entry: wires the handler (handler.ts) to Supabase Auth, the database and Gmail.
import { accessState, signedIn } from '../_shared/auth.ts';
import { DbError, insert, rpc } from '../_shared/db.ts';
import { env, loadConfig, missingConfig } from '../_shared/env.ts';
import { gate, json, originAllowed, readJson } from '../_shared/http.ts';
import { mailConfig, sendMail } from '../_shared/mail.ts';
import { type Deps, handle, type Link } from './handler.ts';

async function link(type: 'invite' | 'recovery', email: string): Promise<Link> {
  const h: Record<string, string> = { apikey: env.serverKey, 'Content-Type': 'application/json' };
  if (env.serverKey.startsWith('eyJ')) h.Authorization = `Bearer ${env.serverKey}`; // legacy service_role JWT
  const res = await fetch(`${env.supabaseUrl}/auth/v1/admin/generate_link`, {
    method: 'POST', headers: h, body: JSON.stringify({ type, email }), signal: AbortSignal.timeout(10000),
  });
  // deno-lint-ignore no-explicit-any
  const b = await res.json().catch(() => ({})) as Record<string, any>;
  const p = b.properties ?? b;
  return {
    status: res.status,
    id: b.user?.id ?? b.id ?? null,
    token: res.ok ? p.hashed_token ?? null : null,
    type: p.verification_type ?? type,
    error: res.ok ? null : String(b.msg ?? b.message ?? b.error_description ?? b.error ?? res.status),
  };
}

const live: Deps = {
  signedIn,
  state: accessState,
  rpc,
  link,
  addMember: async (row) => {
    try {
      await insert('team_members', row);
      return 'added';
    } catch (e) {
      if (e instanceof DbError && e.code === '23505') return 'exists';
      throw e;
    }
  },
  mail: mailConfig,
  send: (cfg, m) => sendMail(cfg, m),
  key: () => env.serverKey,
  later: (p) => {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p);
  },
  originOk: originAllowed,
};

Deno.serve(async (req) => {
  await loadConfig();
  const early = gate(req);
  if (early) return early;
  if (missingConfig([]).length) return json(req, 503, { error: 'The admin sign in is not set up yet.', code: 'not_configured' });
  const parsed = await readJson(req, 10_000);
  if (!parsed) return json(req, 400, { error: 'Send a JSON body.', code: 'bad_request' });
  try {
    return await handle(req, parsed.body, live);
  } catch (e) {
    console.error('team-access:', e instanceof DbError ? `${e.status} ${e.code} ${e.message}` : String(e));
    return json(req, 500, { error: 'Something went wrong. Try again.', code: 'error' });
  }
});
