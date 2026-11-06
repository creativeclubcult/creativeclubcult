// pay-page entry: wires the handler (handler.ts) to the database and Gmail. Public: no sign in, CORS for the site.
import { DbError, rpc } from '../_shared/db.ts';
import { env, loadConfig, missingConfig } from '../_shared/env.ts';
import { gate, json, readJson } from '../_shared/http.ts';
import { mailConfig, sendMail } from '../_shared/mail.ts';
import { callerKey } from '../_shared/pay.ts';
import { type Deps, handle } from './handler.ts';

const live: Deps = {
  rpc,
  who: (req) => callerKey(env.serverKey, req),
  mail: mailConfig,
  send: (cfg, m) => sendMail(cfg, m),
  later: (p) => {
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(p);
  },
  originOk: (origin) => env.origins.includes(origin),
};

Deno.serve(async (req) => {
  await loadConfig();
  const early = gate(req);
  if (early) return early;
  if (missingConfig([]).length) return json(req, 503, { error: 'Halaman ini belum siap. Coba lagi nanti.', code: 'not_configured' });
  const parsed = await readJson(req, 4_000);
  if (!parsed) return json(req, 400, { error: 'Permintaan tidak dikenal.', code: 'bad_request' });
  try {
    return await handle(req, parsed.body, live);
  } catch (e) {
    console.error('pay-page:', e instanceof DbError ? `${e.status} ${e.code} ${e.message}` : String(e));
    return json(req, 500, { error: 'Ada yang salah di sisi kami. Coba lagi sebentar lagi.', code: 'error' });
  }
});
