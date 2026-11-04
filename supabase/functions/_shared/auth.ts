// Who is calling: pg_cron (x-sync-key), a signed-in team member (Bearer JWT), or the Apps Script tick (HMAC).
import { env } from './env.ts';
import { safeEqual, verifyScriptSignature } from './hmac.ts';
import { q, select } from './db.ts';

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

export async function fromUser(req: Request): Promise<UserAuth> {
  const token = bearer(req);
  if (!token || token.split('.').length !== 3) {
    return { ok: false, status: 401, error: 'Sign in to the admin first.', code: 'unauthenticated' };
  }
  const res = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: { Authorization: `Bearer ${token}`, apikey: env.serverKey },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
  const u = await res.json() as { id?: string; email?: string };
  if (!u.id) return { ok: false, status: 401, error: 'Your session has ended. Sign in again.', code: 'unauthenticated' };
  const rows = await select<{ role: string; can_see_money: boolean; email: string | null }>(
    'team_members', `user_id=eq.${q(u.id)}&select=role,can_see_money,email`,
  );
  const m = rows[0];
  if (!m) return { ok: false, status: 403, error: "This account isn't on the team.", code: 'not_team' };
  const owner = m.role === 'owner';
  return {
    ok: true,
    user: {
      id: u.id, email: u.email ?? m.email ?? null, role: m.role,
      canEdit: owner || m.role === 'admin', money: owner || !!m.can_see_money, owner,
    },
  };
}

export async function fromScript(req: Request, raw: string) {
  return await verifyScriptSignature(env.secret, req.headers.get('x-ccc-time'), req.headers.get('x-ccc-sig'), raw);
}
