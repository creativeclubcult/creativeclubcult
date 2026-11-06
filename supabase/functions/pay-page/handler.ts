// pay-page: the client's page behind a private invoice link. Public (verify_jwt off, no sign in): the token is the key.
//
//   view  {token}          {invoice, bank, expires_at, said_paid_at}; counts the view
//   paid  {token, note?}   {ok: true, at}; "I've paid", once per link; the team gets an email when email is set up
//
// Only a live token gets an answer: not turned off, not expired, its invoice still billed (Deal or Lunas) and in
// Rekap Project. Anything else is the same 404, so nobody learns whether a link ever existed. The answer holds that
// one invoice and CCC's bank details, nothing else. Callers are limited by an HMAC of their address (the database:
// 30 asks a minute, 10 dead links in 10 minutes, 300 dead links in 10 minutes from everyone). Text is Indonesian.
import { json } from '../_shared/http.ts';
import type { Mail, MailConfig } from '../_shared/mail.ts';
import { oneLine, paidMail, type Summary, TOKEN_RE, tokenHash } from '../_shared/pay.ts';

export interface Deps {
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** the caller's address as an HMAC */
  who(req: Request): Promise<string>;
  mail(): MailConfig | null;
  send(cfg: MailConfig, m: Mail): Promise<void>;
  /** keep work going after the reply (EdgeRuntime.waitUntil) */
  later(p: Promise<unknown>): void;
  originOk(origin: string): boolean;
}

const SITE = 'https://creativeclubcult.com';
const GONE = { error: 'Link ini sudah tidak berlaku.', code: 'not_found' };
const BUSY = { error: 'Terlalu banyak permintaan. Tunggu sebentar, lalu coba lagi.', code: 'limit' };

type Seen = ({ ok: true } & Summary) | { ok: false; reason: string };
type Paid = ({ ok: true; at: string; again: boolean; project_id?: string } & Partial<Summary>) | { ok: false; reason: string };

export async function handle(req: Request, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const action = body.action === 'view' || body.action === 'paid' ? body.action : null;
  if (!action) return json(req, 400, { error: 'Permintaan tidak dikenal.', code: 'bad_request' });
  const token = typeof body.token === 'string' ? body.token : '';
  // a malformed token never reaches the database
  if (!TOKEN_RE.test(token)) return json(req, 404, GONE);
  const args = { p_hash: await tokenHash(token), p_who: await d.who(req) };

  if (action === 'view') {
    const r = await d.rpc<Seen>('pay_page_view', args);
    if (!r.ok) return r.reason === 'limit' ? json(req, 429, BUSY) : json(req, 404, GONE);
    return json(req, 200, { invoice: r.invoice, bank: r.bank, expires_at: r.expires_at, said_paid_at: r.said_paid_at });
  }

  const note = typeof body.note === 'string' ? oneLine(body.note, 300) || null : null;
  const r = await d.rpc<Paid>('pay_page_paid', { ...args, p_note: note });
  if (!r.ok) {
    if (r.reason === 'limit') return json(req, 429, BUSY);
    if (r.reason === 'nothing_owed') return json(req, 409, { error: 'Tagihan ini sudah lunas. Terima kasih!', code: 'nothing_owed' });
    return json(req, 404, GONE);
  }
  if (!r.again && r.invoice) tellTeam(req, r as Summary & { at: string; project_id?: string }, note, d);
  return json(req, 200, { ok: true, at: r.at });
}

// an email to CCC's own inbox, after the reply; the admin shows it on Finance either way
function tellTeam(req: Request, r: Summary & { at: string; project_id?: string }, note: string | null, d: Deps) {
  const cfg = d.mail();
  if (!cfg) return;
  const origin = req.headers.get('origin') ?? '';
  const site = d.originOk(origin) ? origin : SITE;
  const link = `${site}/admin#${r.project_id ? 'projects/' + r.project_id : 'finance'}`;
  d.later(d.send(cfg, paidMail(cfg.from, { summary: r, at: r.at, note, link }))
    .catch((e) => console.error('pay-page: the email to the team failed:', String(e))));
}
