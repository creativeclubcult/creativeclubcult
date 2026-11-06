// pay-link: a private invoice link for a client, made by an owner or an admin with money access. verify_jwt is off,
// like the other functions: the caller is checked here (signed in, on the team, past the emailed code) and again in
// the database.
//
//   create  {project_id, via: email | whatsapp | copy, to?}   {id, url, expires_at, sent}; email sends the invoice
//   revoke  {id}                                             {ok: true}; the client's page stops working
//
// The link is <origin>/pay#<token> for an origin written exactly in admin_origins, so a link never points anywhere
// else. The rules live in the database (20261106_followups_paylinks, section 5): the invoice is billed (Deal or
// Lunas) and still owed, CCC's bank details are filled in, 20 links per person in 10 minutes, 3 invoice emails an hour
// to one address. A link works for 60 days.
import type { UserAuth } from '../_shared/auth.ts';
import { json } from '../_shared/http.ts';
import { cleanEmail, type Mail, type MailConfig } from '../_shared/mail.ts';
import { invoiceMail, newToken, type Summary, tokenHash } from '../_shared/pay.ts';

export interface Deps {
  user(req: Request): Promise<UserAuth>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  mail(): MailConfig | null;
  send(cfg: MailConfig, m: Mail): Promise<void>;
  originOk(origin: string): boolean;
}

export const DAYS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const id = (v: unknown) => typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null;

type Made = ({ ok: true; id: string; pic: string | null } & Summary) | { ok: false; reason: string };

const REFUSED: Record<string, [number, string]> = {
  forbidden: [403, 'Only owners and admins with money access can send invoice links.'],
  not_found: [404, 'That invoice is gone. Reload the page.'],
  nothing_owed: [409, 'Nothing is owed on this invoice any more.'],
  no_amount: [409, 'The Sheet has no amount owed for this invoice yet. Check it in Rekap Project, then try again.'],
  no_bank: [409, 'Add CCC’s bank details in Settings first.'],
  limit: [429, 'Too many links in a short time. Wait 10 minutes and try again.'],
  limit_to: [429, 'This address got 3 invoice emails in the last hour. Wait an hour, or send the link on WhatsApp.'],
};

export async function handle(req: Request, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const action = body.action;
  if (action !== 'create' && action !== 'revoke') return json(req, 400, { error: 'Unknown action.', code: 'bad_request' });
  const a = await d.user(req);
  if (!a.ok) return json(req, a.status, { error: a.error, code: a.code });
  if (!a.user.canEdit || !a.user.money) {
    return json(req, 403, { error: REFUSED.forbidden[1], code: 'forbidden' });
  }
  return action === 'create' ? await create(req, a.user, body, d) : await revoke(req, a.user.id, body, d);
}

async function create(req: Request, u: { id: string; owner: boolean }, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const project = id(body.project_id);
  const via = body.via === 'email' || body.via === 'whatsapp' || body.via === 'copy' ? body.via : null;
  if (!project || !via) return json(req, 400, { error: 'Choose an invoice and how to send it.', code: 'bad_request' });
  const to = via === 'email' ? cleanEmail(body.to) : null;
  if (via === 'email' && !to) return json(req, 400, { error: 'Enter the client’s email address.', code: 'bad_request' });
  const origin = req.headers.get('origin') ?? '';
  if (!d.originOk(origin)) return json(req, 403, { error: 'Make invoice links from the admin page.', code: 'origin' });
  const cfg = via === 'email' ? d.mail() : null;
  if (via === 'email' && !cfg) {
    return json(req, 503, { error: 'Email isn’t set up on this copy of the admin yet. Send the link on WhatsApp or copy it instead.', code: 'mail_not_configured' });
  }

  const token = newToken();
  const r = await d.rpc<Made>('pay_link_create', {
    p_user: u.id, p_project: project, p_hash: await tokenHash(token), p_via: via, p_to: to, p_days: DAYS,
  });
  if (!r.ok) {
    const [status, error] = REFUSED[r.reason] ?? [500, 'The invoice link couldn’t be made. Try again.'];
    return json(req, status, { error, code: REFUSED[r.reason] ? r.reason : 'error' });
  }
  const url = `${origin}/pay#${token}`;
  if (via !== 'email') return json(req, 200, { id: r.id, url, expires_at: r.expires_at, sent: false });

  try {
    await d.send(cfg!, invoiceMail(to!, { pic: r.pic, summary: r, url }));
  } catch (e) {
    // nobody got this link, so it goes again and the list keeps only links that went out
    await d.rpc('pay_link_drop', { p_id: r.id, p_user: u.id }).catch(() => {});
    console.error('pay-link: the invoice email failed:', String(e));
    return json(req, 502, {
      error: 'The email couldn’t be sent. Try again in a minute, or copy a link instead.', code: 'mail_failed',
      ...(u.owner ? { detail: String(e).slice(0, 300) } : {}),
    });
  }
  await d.rpc('pay_link_sent', { p_id: r.id }).catch((e) => console.error('pay-link: sent_at not saved:', String(e)));
  return json(req, 200, { id: r.id, expires_at: r.expires_at, sent: true });
}

async function revoke(req: Request, user: string, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const link = id(body.id);
  if (!link) return json(req, 400, { error: 'Choose a link to turn off.', code: 'bad_request' });
  const r = await d.rpc<{ ok: boolean; reason?: string }>('pay_link_revoke', { p_id: link, p_user: user });
  if (r.ok) return json(req, 200, { ok: true });
  if (r.reason === 'forbidden') return json(req, 403, { error: REFUSED.forbidden[1], code: 'forbidden' });
  return json(req, 404, { error: 'That link is already off or gone.', code: 'not_found' });
}
