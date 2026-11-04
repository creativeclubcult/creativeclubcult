// Minimal PostgREST client with the server (secret) key. Only the sync functions use it; RLS is bypassed,
// so every caller checks permissions first.
import { env } from './env.ts';

export class DbError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: string) {
    super(message);
  }
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { apikey: env.serverKey, 'Content-Type': 'application/json', ...extra };
  if (env.serverKey.startsWith('eyJ')) h.Authorization = `Bearer ${env.serverKey}`; // legacy service_role JWT
  return h;
}

async function call<T>(path: string, init: RequestInit & { prefer?: string } = {}): Promise<T> {
  const h = headers(init.prefer ? { Prefer: init.prefer } : {});
  const res = await fetch(`${env.supabaseUrl}/rest/v1/${path}`, { ...init, headers: h, signal: AbortSignal.timeout(20000) });
  const raw = await res.text();
  let data: unknown = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) {
    const e = (data ?? {}) as { code?: string; message?: string; details?: string };
    throw new DbError(res.status, e.code ?? String(res.status), e.message ?? `Database error ${res.status}`, e.details);
  }
  return data as T;
}

export function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return call<T>(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
}

export function select<T>(table: string, query: string): Promise<T[]> {
  return call<T[]>(`${table}?${query}`, { method: 'GET' });
}

/** All rows in pages of 1000 (the API's default row cap). `query` must include an `order=`. */
export async function selectAll<T>(table: string, query: string, page = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let off = 0; off < 100000; off += page) {
    const rows = await select<T>(table, `${query}&limit=${page}&offset=${off}`);
    out.push(...rows);
    if (rows.length < page) break;
  }
  return out;
}

export async function insert<T>(table: string, row: Record<string, unknown>, query = ''): Promise<T> {
  const out = await call<T[]>(`${table}${query ? '?' + query : ''}`, {
    method: 'POST', body: JSON.stringify(row), prefer: 'return=representation',
  });
  return out[0];
}

export function update<T>(table: string, query: string, patch: Record<string, unknown>): Promise<T[]> {
  return call<T[]>(`${table}?${query}`, { method: 'PATCH', body: JSON.stringify(patch), prefer: 'return=representation' });
}

export function upsert<T>(table: string, rows: Record<string, unknown>[], onConflict: string): Promise<T[]> {
  return call<T[]>(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: 'POST', body: JSON.stringify(rows), prefer: 'return=representation,resolution=merge-duplicates',
  });
}

export const q = encodeURIComponent;

// ---- sync_state (service role only) ----

export async function getState<T = Record<string, unknown>>(key: string): Promise<T | null> {
  const rows = await select<{ value: T }>('sync_state', `key=eq.${q(key)}&select=value`);
  return rows[0]?.value ?? null;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await upsert('sync_state', [{ key, value, updated_at: new Date().toISOString() }], 'key');
}

// ---- integration_status (the Google Sheet card) ----

export async function setIntegration(patch: {
  status?: 'connected' | 'error'; last_error?: string | null; last_success_at?: string; last_heartbeat_at?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const cur = await select<{ status: string; detail: Record<string, unknown> }>('integration_status', 'key=eq.google_sheets&select=status,detail');
  // status is NOT NULL without a default, and an upsert checks that before it finds the existing row: always send it
  const row: Record<string, unknown> = {
    key: 'google_sheets', status: patch.status ?? cur[0]?.status ?? 'connected', updated_at: new Date().toISOString(),
  };
  if (patch.last_error !== undefined) row.last_error = patch.last_error === null ? null : patch.last_error.slice(0, 300);
  if (patch.last_success_at) row.last_success_at = patch.last_success_at;
  if (patch.last_heartbeat_at) row.last_heartbeat_at = patch.last_heartbeat_at;
  if (patch.detail) row.detail = { ...(cur[0]?.detail ?? {}), ...patch.detail };
  await upsert('integration_status', [row], 'key');
}
