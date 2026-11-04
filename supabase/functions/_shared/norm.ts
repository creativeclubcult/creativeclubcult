// Normalising Sheet cells the same way public.sheets_commit reads them (private.j_* helpers),
// so values that go through here come out of the database unchanged.
import { md5Hex } from './md5.ts';
import type { Cell, ErrCell, KasRow } from './snapshot.ts';

export function isErr(v: unknown): v is ErrCell {
  return typeof v === 'object' && v !== null && typeof (v as ErrCell).err === 'string';
}

export function text(v: unknown, cap = 500): string | null {
  if (v === null || v === undefined || isErr(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v).slice(0, cap) : null;
  if (typeof v === 'boolean') return String(v);
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, cap).trim();
  return s === '' ? null : s;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && /^-?[0-9]{1,15}(\.[0-9]{1,10})?$/.test(v.trim())) return Number(v.trim());
  return null;
}

export function money(v: unknown): number | null {
  const n = num(v);
  return n === null || Math.abs(n) >= 1e15 ? null : Math.round(n);
}

export function int(v: unknown): number | null {
  const n = num(v);
  return n === null || Math.abs(n) > 2e9 ? null : Math.round(n);
}

export function ratio(v: unknown, lim = 100): number | null {
  const n = num(v);
  return n === null || Math.abs(n) >= lim ? null : Math.round(n * 1e4) / 1e4;
}

const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

/** "YYYY-MM-DD" from an ISO date, a Sheets serial day number, or "dd/mm/yyyy" text; anything else → null. */
export function date(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    return new Date(SERIAL_EPOCH + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return valid(+m[3], +m[2], +m[1]);
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

/** Postgres jsonb text output of an array of scalars: `["a", 1, null]` with ", " separators. */
export function pgJsonArrayText(items: (string | number | null)[]): string {
  return '[' + items.map((x) => x === null ? 'null' : JSON.stringify(x)).join(', ') + ']';
}

export const KAS_KEYS = ['entry_date', 'kind', 'category', 'project_tab', 'description', 'counterparty', 'amount',
  'paid', 'method', 'proof_url', 'note'] as const;
export type KasKey = typeof KAS_KEYS[number];
export type KasFields = { [K in KasKey]: K extends 'amount' ? number | null : string | null };

/** The 11 Kas cells as the database stores them (caps equal the kas_entries column checks). */
export function kasFields(r: Partial<Record<KasKey, Cell | undefined>>): KasFields {
  return {
    entry_date: date(r.entry_date),
    kind: text(r.kind, 20),
    category: text(r.category, 80),
    project_tab: text(r.project_tab, 100),
    description: text(r.description, 1000),
    counterparty: text(r.counterparty, 200),
    amount: money(r.amount),
    paid: text(r.paid, 20),
    method: text(r.method, 40),
    proof_url: text(r.proof_url, 1000),
    note: text(r.note, 1000),
  };
}

/** Same value as the SQL fallback md5(jsonb_build_array(entry_date, kind, … note)::text). */
export function kasHash(f: KasFields): string {
  return md5Hex(pgJsonArrayText(KAS_KEYS.map((k) => f[k])));
}

export function kasRowFields(r: KasRow): KasFields {
  return kasFields(r);
}
