// pay-link entry: wires the handler (handler.ts) to Supabase Auth, the database and Gmail.
import { fromUser } from '../_shared/auth.ts';
import { DbError, rpc } from '../_shared/db.ts';
import { env, loadConfig, missingConfig } from '../_shared/env.ts';
import { gate, json, readJson } from '../_shared/http.ts';
import { mailConfig, sendMail } from '../_shared/mail.ts';
import { type Deps, handle } from './handler.ts';

const live: Deps = {
  user: fromUser,
  rpc,
  mail: mailConfig,
  send: (cfg, m) => sendMail(cfg, m),
  // a link goes only to an origin listed exactly in admin_origins, never one a wildcard (http://localhost:*) lets in
  originOk: (origin) => env.origins.includes(origin),
};

Deno.serve(async (req) => {
  await loadConfig();
  const early = gate(req);
  if (early) return early;
  if (missingConfig([]).length) return json(req, 503, { error: 'Invoice links are not set up yet.', code: 'not_configured' });
  const parsed = await readJson(req, 10_000);
  if (!parsed) return json(req, 400, { error: 'Send a JSON body.', code: 'bad_request' });
  try {
    return await handle(req, parsed.body, live);
  } catch (e) {
    console.error('pay-link:', e instanceof DbError ? `${e.status} ${e.code} ${e.message}` : String(e));
    return json(req, 500, { error: 'Something went wrong. Try again.', code: 'error' });
  }
});
