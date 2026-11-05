// Who is calling: pg_cron (x-sync-key), a signed-in team member (Bearer JWT), or the Apps Script tick (HMAC).
// A team member's sign in also has to pass the code emailed after the password, once codes are on (20261105_two_step).
import { env } from './env.ts';
import { safeEqual, verifyScriptSignature } from './hmac.ts';
import { rpc } from './db.ts';

export interface TeamUser {
  id: string;
  email: string | null;
  role: 'owner' | 'admin' | 'viewer' | string;
  canEdit: boolean;
  money: boolean;
  owner: boolean;
}

export type UserAuth = { ok: true; user: TeamUser } | { ok: false; status: 401 | 403; error: string; code: string };

export function hasCronKey(req: Request): boolean {
  return req.headers.has('x-sync-key');
}

export function fromCron(req: Request): boolean {
  const k = req.headers.get('x-sync-key') ?? '';
  return env.cronKey.length >= 32 && safeEqual(k, env.cronKey);
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? m[1] : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The middle of a JWT. Only read after Supabase Auth has accepted the token. */
export function jwtClaims(token: string): Record<string, unknown> {
  try {
    const b = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
    const out = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    return out && typeof out === 'object' ? out : {};
  } catch {
    return {};
  }
}

export interface SignedIn { id: string; email: string | null; sessionId: string }
export type SignedInAuth = { ok: true; who: SignedIn } | { ok: false; status: 401; error: string; code: string };

/** Any signed-in account (Supabase Auth checks the token and that its session still exists). */
export async function signedIn(req: Request): Promise<SignedInAuth> {
  const token = bearer(req);
  if (!token || token.split('.').length !== 3) {
    return { ok: false, status: 401, error: 'Sign in to the admin first.', code: 'unauthenticated' };
  }
  const ended = { ok: false as const, status: 401 as const, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.serverKey },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return ended;
  const u = await res.json() as { id?: string; email?: string };
  const c = jwtClaims(token);
  const sid = typeof c.session_id === 'string' ? c.session_id : '';
  if (!u.id || c.sub !== u.id || !UUID_RE.test(sid)) return ended;
  return { ok: true, who: { id: u.id, email: u.email ?? null, sessionId: sid.toLowerCase() } };
}

export interface AccessState {
  member: boolean; role: string | null; money: boolean; email: string | null; name: string | null;
  required: boolean; verified: boolean; code_live: boolean;
}

/** On the team? Has this sign in passed the emailed code, and are codes required yet? */
export function accessState(who: SignedIn): Promise<AccessState> {
  return rpc<AccessState>('access_state', { p_user: who.id, p_session: who.sessionId });
}

export async function fromUser(req: Request): Promise<UserAuth> {
  const s = await signedIn(req);
  if (!s.ok) return s;
  const st = await accessState(s.who);
  if (!st.member) return { ok: false, status: 403, error: "This account isn't on the team.", code: 'not_team' };
  if (st.required && !st.verified) {
    return { ok: false, status: 403, error: 'Enter the code from your email first.', code: 'needs_code' };
  }
  const owner = st.role === 'owner';
  return {
    ok: true,
    user: {
      id: s.who.id, email: s.who.email ?? st.email ?? null, role: st.role ?? '',
      canEdit: owner || st.role === 'admin', money: owner || st.money, owner,
    },
  };
}

export async function fromScript(req: Request, raw: string) {
  return await verifyScriptSignature(env.secret, req.headers.get('x-ccc-time'), req.headers.get('x-ccc-sig'), raw);
}
