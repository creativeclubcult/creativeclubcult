// Every admin → Sheet op: argument schema, permission, target key (one active op per target) and the
// sentence the admin shows for each error code. Apps Script validates again against the live Sheet.
import { date, kasFields, kasHash, text } from './norm.ts';

export type Perm = 'edit' | 'owner';
type Args = Record<string, unknown>;
export type Checked =
  | { ok: true; args: Args; target: string; projectId?: string; money: boolean }
  | { ok: false; error: string; code: string; status?: number };

export const DOC_TYPES = ['PENAWARAN', 'INVOICE', 'KWITANSI'];
export const STATUSES = ['Draft', 'Dikirim', 'Deal', 'Lunas', 'Batal'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MONEY = 1e12;

const bad = (error: string, code = 'invalid'): Checked => ({ ok: false, error, code });

function isObj(v: unknown): v is Args {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

type FieldRule = { kind: 'text'; max: number; required?: boolean } | { kind: 'money' } | { kind: 'date' } |
  { kind: 'pct'; min?: number; max?: number; required?: boolean } | { kind: 'enum'; values: string[]; nullable?: boolean } |
  { kind: 'url' };

function checkField(name: string, rule: FieldRule, v: unknown): { ok: true; v: unknown } | { ok: false; error: string } {
  if (v === null || v === '') {
    if (rule.kind === 'enum' && !rule.nullable) return { ok: false, error: `${name} can't be empty.` };
    if ((rule.kind === 'text' || rule.kind === 'pct') && rule.required) return { ok: false, error: `${name} can't be empty.` };
    return { ok: true, v: null };
  }
  switch (rule.kind) {
    case 'text': {
      if (typeof v !== 'string' && typeof v !== 'number') return { ok: false, error: `${name} must be text.` };
      const s = String(v).trim();
      if (s.length > rule.max) return { ok: false, error: `${name} is longer than ${rule.max} characters.` };
      return { ok: true, v: s };
    }
    case 'money':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > MAX_MONEY) return { ok: false, error: `${name} must be a whole amount in Rupiah.` };
      return { ok: true, v };
    case 'pct': {
      const lo = rule.min ?? 0, hi = rule.max ?? 1;
      if (typeof v !== 'number' || !(v >= lo && v <= hi)) {
        return { ok: false, error: `${name} must be between ${Math.round(lo * 100)}% and ${Math.round(hi * 100)}%.` };
      }
      return { ok: true, v };
    }
    case 'date': {
      const d = date(v);
      if (!d || typeof v !== 'string') return { ok: false, error: `${name} must be a date.` };
      return { ok: true, v: d };
    }
    case 'enum':
      if (typeof v !== 'string' || !rule.values.includes(v)) return { ok: false, error: `${name} must be one of ${rule.values.join(', ')}.` };
      return { ok: true, v };
    case 'url':
      if (typeof v !== 'string' || !/^https:\/\/\S{4,990}$/.test(v)) return { ok: false, error: `${name} must be an https link.` };
      return { ok: true, v };
  }
}

function checkSet(obj: unknown, rules: Record<string, FieldRule>, label: string, allowEmpty = false): { ok: true; v: Args } | { ok: false; error: string } {
  if (!isObj(obj)) return { ok: false, error: `${label} is missing.` };
  const out: Args = {};
  for (const [k, v] of Object.entries(obj)) {
    const rule = rules[k];
    if (!rule) return { ok: false, error: `${k} can't be changed from the admin.` };
    const c = checkField(k, rule, v);
    if (!c.ok) return c;
    out[k] = c.v;
  }
  if (!allowEmpty && Object.keys(out).length === 0) return { ok: false, error: 'Nothing to change.' };
  return { ok: true, v: out };
}

/** `expect` holds what the admin showed; values are compared, not validated, but keys must be known. */
function checkExpect(obj: unknown, rules: Record<string, FieldRule>): { ok: true; v: Args | undefined } | { ok: false; error: string } {
  if (obj === undefined || obj === null) return { ok: true, v: undefined };
  if (!isObj(obj)) return { ok: false, error: 'expect must be an object.' };
  for (const k of Object.keys(obj)) if (!rules[k]) return { ok: false, error: `Unknown field ${k}.` };
  return { ok: true, v: obj };
}

const PROJECT_SET: Record<string, FieldRule> = {
  status: { kind: 'enum', values: STATUSES }, final_file_date: { kind: 'date' },
  dp_received: { kind: 'money' }, dp_date: { kind: 'date' }, final_received: { kind: 'money' }, final_date: { kind: 'date' },
  cost_override: { kind: 'money' },
};
const PROJECT_MONEY = new Set(['dp_received', 'dp_date', 'final_received', 'final_date', 'cost_override']);

const RAB_META: Record<string, FieldRule> = {
  doc_type: { kind: 'enum', values: DOC_TYPES }, title: { kind: 'text', max: 200, required: true },
  client_label: { kind: 'text', max: 200, required: true }, product: { kind: 'text', max: 200 },
  photographer: { kind: 'text', max: 200 }, quote_date: { kind: 'date' }, locations: { kind: 'text', max: 200 },
  shooting_days: { kind: 'text', max: 200 }, usage: { kind: 'text', max: 200 }, location: { kind: 'text', max: 200 },
  language: { kind: 'text', max: 200 }, discount_pct: { kind: 'pct' }, ppn_pct: { kind: 'pct' }, dp_pct: { kind: 'pct' },
  pph23_pct: { kind: 'pct' },
  // ALOKASI DANA block: net profit share of the money left after the PR and internal fees
  net_profit_pct: { kind: 'pct', min: 0.1, max: 0.25, required: true },
};

export const KAS_RULES: Record<string, FieldRule> = {
  entry_date: { kind: 'date' }, kind: { kind: 'enum', values: ['Keluar', 'Masuk'] },
  category: { kind: 'text', max: 80, required: true }, project_tab: { kind: 'text', max: 100 },
  description: { kind: 'text', max: 1000, required: true }, counterparty: { kind: 'text', max: 200 },
  amount: { kind: 'money' }, paid: { kind: 'enum', values: ['Sudah', 'Belum'] },
  method: { kind: 'enum', values: ['Transfer', 'Cash', 'QRIS'], nullable: true }, proof_url: { kind: 'url' },
  note: { kind: 'text', max: 1000 },
};
const KAS_REQUIRED = ['entry_date', 'kind', 'category', 'description', 'amount', 'paid'];

const CLIENT_SET: Record<string, FieldRule> = {
  name: { kind: 'text', max: 200, required: true }, pic: { kind: 'text', max: 200 }, phone: { kind: 'text', max: 60 },
  email: { kind: 'text', max: 254 }, npwp: { kind: 'text', max: 60 }, address: { kind: 'text', max: 500 },
  note: { kind: 'text', max: 1000 },
};
const CREW_SET: Record<string, FieldRule> = {
  role: { kind: 'text', max: 120 }, rate: { kind: 'money' }, rate_unit: { kind: 'text', max: 40 },
  phone: { kind: 'text', max: 60 }, note: { kind: 'text', max: 1000 },
};

function projectId(a: Args): string | null {
  return typeof a.project_id === 'string' && UUID_RE.test(a.project_id) ? a.project_id.toLowerCase() : null;
}

function kasRow(v: unknown, label: string): { ok: true; v: Args } | { ok: false; error: string } {
  const c = checkSet(v, KAS_RULES, label);
  if (!c.ok) return c;
  for (const k of KAS_REQUIRED) if (c.v[k] === undefined || c.v[k] === null) return { ok: false, error: `${k} is required.` };
  return c;
}

function kasMatchHash(m: Args): string {
  return kasHash(kasFields(m as Record<string, string | number | null>));
}

export interface OpDef {
  perm: Perm;
  milestone: string;
  enabled: boolean;
  check(a: Args, opId: string): Checked;
}

const notEnabled: OpDef['check'] = () => bad("Editing RAB lines from the admin isn't switched on yet. Edit them in the Sheet.", 'not_enabled');

export const OPS: Record<string, OpDef> = {
  project_set: {
    perm: 'edit', milestone: 'M2', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const s = checkSet(a.set, PROJECT_SET, 'set');
      if (!s.ok) return bad(s.error);
      const e = checkExpect(a.expect, PROJECT_SET);
      if (!e.ok) return bad(e.error);
      const money = Object.keys(s.v).some((k) => PROJECT_MONEY.has(k));
      return { ok: true, args: { project_id: pid, set: s.v, expect: e.v, force: a.force === true }, target: `project:${pid}`, projectId: pid, money };
    },
  },
  rab_meta: {
    perm: 'edit', milestone: 'M4', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const s = checkSet(a.set, RAB_META, 'set');
      if (!s.ok) return bad(s.error);
      const e = checkExpect(a.expect, RAB_META);
      if (!e.ok) return bad(e.error);
      return { ok: true, args: { project_id: pid, set: s.v, expect: e.v, force: a.force === true }, target: `project:${pid}`, projectId: pid, money: true };
    },
  },
  lock_prices: {
    perm: 'edit', milestone: 'M4', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      return { ok: true, args: { project_id: pid }, target: `project:${pid}`, projectId: pid, money: false };
    },
  },
  export_pdf: {
    perm: 'edit', milestone: 'M4', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      if (a.doc_type !== undefined && !DOC_TYPES.includes(String(a.doc_type))) return bad('Pick PENAWARAN, INVOICE or KWITANSI.');
      return {
        ok: true,
        args: { project_id: pid, doc_type: a.doc_type ?? null, lock: a.lock === true, accept_placeholders: a.accept_placeholders === true },
        target: `project:${pid}`, projectId: pid, money: true,
      };
    },
  },
  create_rab: {
    perm: 'edit', milestone: 'M3', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Save the project first.');
      const code = typeof a.code === 'string' ? a.code.trim().toUpperCase() : '';
      if (!/^[A-Z]{2,5}$/.test(code)) return bad('The client code must be 2 to 5 capital letters.');
      const project = text(a.project, 80);
      if (!project) return bad('Give the project a short name.');
      if (!DOC_TYPES.includes(String(a.doc_type ?? 'PENAWARAN'))) return bad('Pick PENAWARAN, INVOICE or KWITANSI.');
      let client: Args | null = null;
      if (a.client !== undefined && a.client !== null) {
        const c = checkSet(a.client, { name: CLIENT_SET.name, pic: CLIENT_SET.pic, phone: CLIENT_SET.phone, email: CLIENT_SET.email }, 'client');
        if (!c.ok) return bad(c.error);
        client = c.v;
      }
      return {
        ok: true, args: { project_id: pid, code, client, project, doc_type: a.doc_type ?? 'PENAWARAN' },
        target: `project:${pid}`, projectId: pid, money: false,
      };
    },
  },
  kas_add: {
    perm: 'edit', milestone: 'M2', enabled: true,
    check(a, opId) {
      const r = kasRow(a.row, 'row');
      if (!r.ok) return bad(r.error);
      if (r.v.note === undefined || r.v.note === null) r.v.note = 'via Admin';
      return { ok: true, args: { row: r.v, allow_duplicate: a.allow_duplicate === true }, target: `kas:new:${opId}`, money: true };
    },
  },
  kas_update: {
    perm: 'edit', milestone: 'M2', enabled: true,
    check(a) {
      if (!Number.isInteger(a.hint_row) || (a.hint_row as number) < 9) return bad('Row is missing.');
      const m = checkSet(a.match, KAS_RULES, 'match');
      if (!m.ok) return bad(m.error);
      const s = checkSet(a.set, KAS_RULES, 'set');
      if (!s.ok) return bad(s.error);
      return {
        ok: true, args: { hint_row: a.hint_row, match: m.v, set: s.v, force: a.force === true },
        target: `kas:${kasMatchHash(m.v)}`, money: true,
      };
    },
  },
  kas_delete: {
    perm: 'owner', milestone: 'M2', enabled: true,
    check(a) {
      if (!Number.isInteger(a.hint_row) || (a.hint_row as number) < 9) return bad('Row is missing.');
      const m = checkSet(a.match, KAS_RULES, 'match');
      if (!m.ok) return bad(m.error);
      return { ok: true, args: { hint_row: a.hint_row, match: m.v }, target: `kas:${kasMatchHash(m.v)}`, money: true };
    },
  },
  client_upsert: {
    perm: 'edit', milestone: 'M2', enabled: true,
    check(a) {
      const code = typeof a.code === 'string' ? a.code.trim().toUpperCase() : '';
      if (!/^[A-Z]{2,5}$/.test(code)) return bad('The client code must be 2 to 5 capital letters.');
      const s = checkSet(a.set, CLIENT_SET, 'set');
      if (!s.ok) return bad(s.error);
      if (a.create === true && !s.v.name) return bad('A new client needs a name.');
      const e = checkExpect(a.expect, CLIENT_SET);
      if (!e.ok) return bad(e.error);
      return { ok: true, args: { code, create: a.create === true, set: s.v, expect: e.v, force: a.force === true }, target: `client:${code}`, money: false };
    },
  },
  crew_upsert: {
    perm: 'edit', milestone: 'M5', enabled: true,
    check(a) {
      const name = text(a.name, 120);
      if (!name) return bad('A crew member needs a name.');
      const s = checkSet(a.set, CREW_SET, 'set', a.create === true);
      if (!s.ok) return bad(s.error);
      const e = checkExpect(a.expect, CREW_SET);
      if (!e.ok) return bad(e.error);
      return {
        ok: true, args: { name, create: a.create === true, set: s.v, expect: e.v, force: a.force === true },
        target: `crew:${name.toLowerCase()}`, money: true,
      };
    },
  },
  rab_line_set: { perm: 'edit', milestone: 'M6', enabled: false, check: notEnabled },
  rab_line_add: { perm: 'edit', milestone: 'M6', enabled: false, check: notEnabled },
  rab_line_clear: { perm: 'edit', milestone: 'M6', enabled: false, check: notEnabled },
  rab_internal: { perm: 'edit', milestone: 'M6', enabled: false, check: notEnabled },
};

export const CONTROL_OPS = ['outbox_retry', 'outbox_discard', 'outbox_force', 'issue_action'];

const MESSAGES: Record<string, string> = {
  conflict: 'Not saved: the Sheet changed meanwhile.',
  duplicate: 'The same entry is already in Kas.',
  formula_guard: 'That change would have broken a formula in the Sheet, so nothing was written.',
  layout: "The Sheet's layout changed, so nothing was written. Tell Claude.",
  not_found: "This isn't in the Sheet anymore.",
  writes_off: 'Sheet writes are paused.',
  no_invoice_no: "The invoice number isn't complete yet: fill in the date, number and client code in the RAB.",
  not_enabled: "Editing RAB lines from the admin isn't switched on yet. Edit them in the Sheet.",
  bad_sig: "The Sheet and the admin don't recognise each other (key changed).",
  wrong_sheet: "The Sheet and the admin don't recognise each other (different Sheet).",
  stale: "The Sheet and the admin clocks disagree. Try again in a minute.",
  replay: 'This request was already used. Try again.',
  write_landed_on_moved_row: 'The Sheet moved rows while saving. Check the change in the Sheet.',
  needs_confirm: 'The Sheet needs a decision before this can be done.',
  busy: 'The Sheet is busy. Retrying shortly.',
  timeout: "The Sheet didn't answer in time. Retrying shortly.",
  unreachable: "The Sheet couldn't be reached. Retrying shortly.",
  rate_limited: 'Google is limiting requests. Retrying shortly.',
  bad_response: 'The Sheet answered in an unexpected way. Retrying shortly.',
};

export function friendly(code: string, fallback?: string): string {
  if (code === 'invalid' && fallback) return fallback;
  return MESSAGES[code] ?? fallback ?? 'The Sheet refused the change.';
}
