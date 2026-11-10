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
  { kind: 'url' } | { kind: 'int'; min: number; max: number } | { kind: 'num'; max: number };

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
      if (s === '') return rule.required ? { ok: false, error: `${name} can't be empty.` } : { ok: true, v: null };   // only spaces: empty
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
    case 'int':
      if (typeof v !== 'number' || !Number.isInteger(v) || v < rule.min || v > rule.max) {
        return { ok: false, error: `${name} must be a whole number from ${rule.min} to ${rule.max}.` };
      }
      return { ok: true, v };
    case 'num':                                             // RAB qty and days: up to 2 decimals, like the Sheet takes them
      if (typeof v !== 'number' || !(v >= 0 && v <= rule.max) || Math.abs(Math.round(v * 100) - v * 100) > 1e-6) {
        return { ok: false, error: `${name} must be a number with at most 2 decimals.` };
      }
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

// A Rekap row's fields that the projects table holds (the whole team reads them); every other field is money
const PROJECT_PLAIN = new Set(['row', 'gid', 'b_link', 'drive_folder_url', 'tab_name', 'invoice_no', 'client_label', 'title',
  'quote_date', 'status', 'note_text', 'final_file_date', 'payment_due']);
const PLAIN_REPLY = new Set(['client', 'tab', 'written', 'noop', 'locked', 'replayed', 'invoice_no', 'doc_type']);

/** A Sheet reply's record as someone without money access may see it: the project's plain fields, the client and
 *  what was written, never the RAB, Kas, crew or PDF. A change that isn't money (locking prices, a new RAB, a status)
 *  still gets the whole tab back from the Sheet, so this goes over every answer and every stored result. */
export function withoutMoney(record: Args): Args {
  const out: Args = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === 'project' && isObj(v)) out.project = Object.fromEntries(Object.entries(v).filter(([f]) => PROJECT_PLAIN.has(f)));
    else if (PLAIN_REPLY.has(k)) out[k] = v;
  }
  return out;
}

const RAB_META: Record<string, FieldRule> = {
  doc_type: { kind: 'enum', values: DOC_TYPES }, title: { kind: 'text', max: 200, required: true },
  client_label: { kind: 'text', max: 200, required: true }, product: { kind: 'text', max: 200 },
  photographer: { kind: 'text', max: 200 }, quote_date: { kind: 'date' }, locations: { kind: 'text', max: 200 },
  shooting_days: { kind: 'text', max: 200 }, usage: { kind: 'text', max: 200 }, location: { kind: 'text', max: 200 },
  language: { kind: 'text', max: 200 }, discount_pct: { kind: 'pct' }, ppn_pct: { kind: 'pct' }, dp_pct: { kind: 'pct' },
  pph23_pct: { kind: 'pct' },
  // ALOKASI DANA block: net profit share of the money left after the PR and internal fees, 0% to 25% (0% since
  // 2026-11-11: a job whose whole budget goes to the team). Empty is refused, so a missing rate never becomes 0%.
  net_profit_pct: { kind: 'pct', min: 0, max: 0.25, required: true },
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

// RAB lines (M6): a breakdown section writes only its own columns (Sync.gs SYNC_SECTIONS), the gear its four inputs
// (I item, J qty and K days from the Sheet's 1 to 30 lists, L manual price). The Sheet checks each line again.
const LINE: Record<string, FieldRule> = {
  no: { kind: 'int', min: 0, max: 999 }, desc: { kind: 'text', max: 500 }, person: { kind: 'text', max: 200 },
  cost: { kind: 'money' }, qty: { kind: 'num', max: 100000 }, unit: { kind: 'text', max: 60 }, days: { kind: 'num', max: 100000 },
};
const pickRules = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, LINE[k]]));
const PLAIN_SECTION = ['no', 'desc', 'cost', 'qty', 'unit', 'days'];
export const SECTION_RULES: Record<string, Record<string, FieldRule>> = {
  pre: pickRules(PLAIN_SECTION), talent: pickRules(['no', 'desc', 'cost', 'qty', 'days']),
  crew: pickRules(['no', 'desc', 'person', 'cost', 'qty', 'days']), location: pickRules(PLAIN_SECTION),
  art: pickRules(PLAIN_SECTION), transport: pickRules(PLAIN_SECTION), catering: pickRules(PLAIN_SECTION),
  post: pickRules(PLAIN_SECTION), others: pickRules(PLAIN_SECTION),
  equipment: {
    item: { kind: 'text', max: 300 }, qty: { kind: 'int', min: 1, max: 30 }, days: { kind: 'int', min: 1, max: 30 },
    manual_price: { kind: 'money' },
  },
};
export const EQ_GROUPS = ['CAMERA', 'LENS', 'CAMERA SUPPORT', 'BACKGROUND', 'LIGHTING', 'LIGHTING SUPPORT', 'AUDIO', 'LAINNYA'];
const INTERNAL: Record<string, FieldRule> = {
  ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`actual_${i + 1}`, { kind: 'money' } as FieldRule])),
  other_estimate: { kind: 'money' }, other_actual: { kind: 'money' },
};

function lineSection(v: unknown): { key: string; rules: Record<string, FieldRule>; id: string } | null {
  const key = typeof v === 'string' ? v : '';
  return Object.prototype.hasOwnProperty.call(SECTION_RULES, key) ? { key, rules: SECTION_RULES[key], id: key === 'equipment' ? 'item' : 'desc' } : null;
}
const lineRow = (v: unknown) => Number.isInteger(v) && (v as number) >= 41 && (v as number) <= 20000;

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
  rab_line_set: {
    perm: 'edit', milestone: 'M6', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const sec = lineSection(a.section);
      if (!sec) return bad('Pick a section.');
      if (!Array.isArray(a.lines) || a.lines.length < 1 || a.lines.length > 40) return bad('Send 1 to 40 lines.');
      const seen = new Set<number>();
      const lines: Args[] = [];
      for (const l of a.lines) {
        if (!isObj(l) || !lineRow(l.row)) return bad('A line has no row.');
        const row = l.row as number;
        if (seen.has(row)) return bad(`Row ${row} is sent twice.`);
        seen.add(row);
        const s = checkSet(l.set, sec.rules, 'set');
        if (!s.ok) return bad(s.error);
        if (s.v[sec.id] === null) return bad('Use Remove line to take a line out.');
        const e = checkExpect(l.expect, sec.rules);
        if (!e.ok) return bad(e.error);
        lines.push({ row, set: s.v, expect: e.v ?? {} });
      }
      return { ok: true, args: { project_id: pid, section: sec.key, lines, force: a.force === true }, target: `project:${pid}`, projectId: pid, money: true };
    },
  },
  rab_line_add: {
    perm: 'edit', milestone: 'M6', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const sec = lineSection(a.section);
      if (!sec) return bad('Pick a section.');
      const group = sec.key === 'equipment' && typeof a.group === 'string' ? a.group.trim().toUpperCase() : null;
      if (sec.key === 'equipment' && !EQ_GROUPS.includes(group ?? '')) return bad('Pick an equipment group.');
      const s = checkSet(a.set, sec.rules, 'set');
      if (!s.ok) return bad(s.error);
      if (s.v[sec.id] === undefined || s.v[sec.id] === null) return bad(sec.key === 'equipment' ? 'Pick or type the equipment.' : 'A line needs a description.');
      return { ok: true, args: { project_id: pid, section: sec.key, group, set: s.v }, target: `project:${pid}`, projectId: pid, money: true };
    },
  },
  rab_line_clear: {
    perm: 'edit', milestone: 'M6', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const sec = lineSection(a.section);
      if (!sec) return bad('Pick a section.');
      if (!lineRow(a.row)) return bad('A line has no row.');
      const e = checkExpect(a.expect, sec.rules);
      if (!e.ok) return bad(e.error);
      if (!e.v || !Object.keys(e.v).length) return bad('expect is missing.');
      return { ok: true, args: { project_id: pid, section: sec.key, row: a.row, expect: e.v }, target: `project:${pid}`, projectId: pid, money: true };
    },
  },
  rab_internal: {
    perm: 'edit', milestone: 'M6', enabled: true,
    check(a) {
      const pid = projectId(a);
      if (!pid) return bad('Pick a project.');
      const s = checkSet(a.set, INTERNAL, 'set');
      if (!s.ok) return bad(s.error);
      const e = checkExpect(a.expect, INTERNAL);
      if (!e.ok) return bad(e.error);
      return { ok: true, args: { project_id: pid, set: s.v, expect: e.v, force: a.force === true }, target: `project:${pid}`, projectId: pid, money: true };
    },
  },
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
  not_enabled: "This can't be done from the admin yet. Do it in the Sheet.",
  line_moved: 'This line changed or moved in the Sheet. Check it and try again.',
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
