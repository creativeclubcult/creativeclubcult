// team-access: the second step of signing in (a 6 digit code emailed after the password), adding people to the team,
// and links to set a password. verify_jwt is off, like the sheets functions: every action checks its caller here.
//
//   status  any signed-in account   on the team? did this sign in pass a code? are codes required? can email go out?
//   send    a team member           email a code for this sign in (one a minute, 5 in 15 minutes, 20 a day)
//   verify  a team member           check it (5 tries per code); the first owner in with a code turns codes on for all
//   invite  an owner                make the account, add it to the team, email a link to set a password
//   reset   anyone, from the admin  a link to set a new password, only to emails on the team; the reply is always the same
//
// The rules live in the database (20261105_two_step): limits, tries, expiry and the switch are checked there.
import type { AccessState, SignedIn, SignedInAuth } from '../_shared/auth.ts';
import { json } from '../_shared/http.ts';
import { cleanEmail, codeHash, codeMail, inviteMail, type Mail, type MailConfig, newCode, resetMail } from '../_shared/mail.ts';

export interface Link { status: number; id: string | null; token: string | null; type: string | null; error: string | null }

export interface Deps {
  signedIn(req: Request): Promise<SignedInAuth>;
  state(who: SignedIn): Promise<AccessState>;
  rpc<T>(fn: string, args: Record<string, unknown>): Promise<T>;
  /** Supabase Auth's generate_link: makes the account for an invite; sends nothing by itself */
  link(type: 'invite' | 'recovery', email: string): Promise<Link>;
  addMember(row: Record<string, unknown>): Promise<'added' | 'exists'>;
  mail(): MailConfig | null;
  send(cfg: MailConfig, m: Mail): Promise<void>;
  key(): string;
  /** keep work going after the reply (EdgeRuntime.waitUntil) */
  later(p: Promise<unknown>): void;
  originOk(origin: string): boolean;
}

const ACTIONS = ['status', 'send', 'verify', 'invite', 'reset'];
const NO_MAIL = { error: "Codes by email aren't set up yet.", code: 'mail_not_configured' };
const ENDED = { error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
const NOT_TEAM = { error: "This account isn't on the team.", code: 'not_team' };

export async function handle(req: Request, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.includes(action)) return json(req, 400, { error: 'Unknown action.', code: 'bad_request' });
  if (action === 'reset') return await reset(req, body, d);

  const s = await d.signedIn(req);
  if (!s.ok) return json(req, s.status, { error: s.error, code: s.code });
  const st = await d.state(s.who);
  if (action === 'status') {
    if (!st.member) return json(req, 200, { member: false });
    return json(req, 200, {
      member: true, role: st.role, verified: st.verified, required: st.required, mail: !!d.mail(), code_live: st.code_live,
    });
  }
  if (!st.member) return json(req, 403, NOT_TEAM);
  if (action === 'send') return await send(req, s.who, st, d);
  if (action === 'verify') return await verify(req, s.who, body, d);
  return await invite(req, s.who, st, body, d);
}

async function send(req: Request, who: SignedIn, st: AccessState, d: Deps): Promise<Response> {
  if (st.verified) return json(req, 200, { sent: false, verified: true });
  const cfg = d.mail();
  if (!cfg) return json(req, 503, NO_MAIL);
  const to = cleanEmail(who.email);
  if (!to) return json(req, 422, { error: 'This account has no email to send a code to.', code: 'no_email' });
  const code = newCode();
  const r = await d.rpc<{ ok: boolean; reason?: string; wait?: number }>('access_code_issue', {
    p_user: who.id, p_session: who.sessionId, p_hash: await codeHash(d.key(), who.sessionId, code),
  });
  if (!r.ok) {
    if (r.reason === 'wait') return json(req, 200, { sent: false, wait: r.wait ?? 60 });
    if (r.reason === 'limit') return json(req, 429, { error: 'Too many codes for now. Wait 15 minutes, then send a new one.', code: 'limit' });
    if (r.reason === 'not_team') return json(req, 403, NOT_TEAM);
    return json(req, 401, ENDED);
  }
  try {
    await d.send(cfg, codeMail(to, code));
  } catch (e) {
    await d.rpc('access_code_drop', { p_user: who.id, p_session: who.sessionId }).catch(() => {});
    console.error('team-access: the code email failed:', String(e));
    return json(req, 502, {
      error: "The code couldn't be sent. Try again in a minute.", code: 'mail_failed',
      ...(st.role === 'owner' ? { detail: String(e).slice(0, 300) } : {}),
    });
  }
  return json(req, 200, { sent: true });
}

const TRIES: Record<string, (left: number) => string> = {
  wrong: (left) => `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`,
  too_many: () => 'Too many tries. Send a new code.',
  expired: () => 'That code has expired. Send a new one.',
  no_code: () => 'There is no code waiting. Send a new one.',
  no_session: () => ENDED.error,
  not_team: () => NOT_TEAM.error,
};

async function verify(req: Request, who: SignedIn, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const code = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : '';
  if (!/^\d{6}$/.test(code)) return json(req, 400, { error: 'Enter the 6 digit code from the email.', code: 'bad_request' });
  const r = await d.rpc<{ ok: boolean; reason?: string; left?: number; turned_on?: boolean }>('access_code_check', {
    p_user: who.id, p_session: who.sessionId, p_hash: await codeHash(d.key(), who.sessionId, code),
  });
  if (r.ok) return json(req, 200, { ok: true, turned_on: !!r.turned_on });
  const reason = r.reason ?? 'wrong', left = Math.max(0, r.left ?? 0);
  const said = (TRIES[reason] ?? (() => "That code didn't work. Send a new one."))(left);
  return json(req, reason === 'no_session' ? 401 : 422, { ok: false, code: reason, left, error: said });
}

const tidyName = (v: unknown) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || null : null;

async function invite(req: Request, who: SignedIn, st: AccessState, body: Record<string, unknown>, d: Deps): Promise<Response> {
  if (st.role !== 'owner') return json(req, 403, { error: 'Only an owner can add people to the team.', code: 'forbidden' });
  if (st.required && !st.verified) return json(req, 403, { error: 'Enter the code from your email first.', code: 'needs_code' });
  const origin = req.headers.get('origin') ?? '';
  if (!d.originOk(origin)) return json(req, 403, { error: 'Add people from the admin page.', code: 'origin' });
  const cfg = d.mail();
  if (!cfg) return json(req, 503, { error: "Adding people sends them an email, and email isn't set up yet.", code: 'mail_not_configured' });
  const email = cleanEmail(body.email);
  if (!email) return json(req, 400, { error: 'Enter a valid email.', code: 'bad_request' });
  const role = body.role === 'admin' || body.role === 'viewer' ? body.role : null;
  if (!role) return json(req, 400, { error: 'Choose Admin or Viewer.', code: 'bad_request' });
  const name = tidyName(body.name), money = body.money === true;

  const taken = { error: 'That email is already on the team.', code: 'already_member' };
  if (await d.rpc<string | null>('access_member_email', { p_email: email })) return json(req, 409, taken);
  if (!(await d.rpc<boolean>('access_mail_allow', { p_kind: 'invite', p_email: email, p_user: who.id }))) {
    return json(req, 429, { error: 'Too many invitations to this email. Wait an hour and try again.', code: 'limit' });
  }
  // a new account comes with the invite; an account that exists already (on the team before) gets a reset link instead
  let link = await d.link('invite', email);
  if (!link.token && link.status === 422) link = await d.link('recovery', email);
  if (!link.token || !link.id) {
    console.error('team-access: generate_link failed:', link.status, link.error);
    return json(req, 502, { error: "The account couldn't be made. Try again.", code: 'auth_failed' });
  }
  if ((await d.addMember({ user_id: link.id, email, full_name: name, role, can_see_money: money })) === 'exists') {
    return json(req, 409, taken);
  }
  const kind = link.type === 'invite' ? 'invite' : 'recovery';
  const url = `${origin}/admin/#set=${encodeURIComponent(link.token)}&t=${kind}`;
  try {
    await d.send(cfg, inviteMail(email, { name, by: st.name, role, money, link: url, signIn: `${origin}/admin` }));
  } catch (e) {
    console.error('team-access: the invitation email failed:', String(e));
    return json(req, 200, { ok: true, mailed: false });
  }
  return json(req, 200, { ok: true, mailed: true });
}

async function reset(req: Request, body: Record<string, unknown>, d: Deps): Promise<Response> {
  const origin = req.headers.get('origin') ?? '';
  if (!d.originOk(origin)) return json(req, 403, { error: 'Open the admin to reset a password.', code: 'origin' });
  const email = cleanEmail(body.email);
  if (!email) return json(req, 400, { error: 'Type your email first.', code: 'bad_request' });
  const cfg = d.mail();
  if (!cfg) return json(req, 503, NO_MAIL);
  // the same answer, as fast, whether or not the email is on the team: the work goes on after the reply
  const work = (async () => {
    if (!(await d.rpc<boolean>('access_mail_allow', { p_kind: 'reset', p_email: email }))) return;
    const target = await d.rpc<string | null>('access_member_email', { p_email: email });
    if (!target) return;
    const link = await d.link('recovery', target);
    if (!link.token) {
      console.error('team-access: generate_link failed:', link.status, link.error);
      return;
    }
    await d.send(cfg, resetMail(target, `${origin}/admin/#set=${encodeURIComponent(link.token)}&t=recovery`));
  })().catch((e) => console.error('team-access: reset failed:', String(e)));
  d.later(work);
  return json(req, 200, { ok: true });
}
