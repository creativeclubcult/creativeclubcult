// Pure: Apps Script snapshot (or a write reply) + what the database already holds → the JSON that
// public.sheets_commit(p) takes. No I/O here, so every rule is unit-tested with fixtures (supabase/tests).
//
// Division of work with sheets_commit (the SQL is the single writer and re-checks everything):
//   - here: which sections are complete, gid of every Rekap row (name, then the #gid= link), Kas pairing
//     by content hash + nearest row (sent as `replaces` hints, which the SQL applies first), formula-error /
//     layout / Form issues and their resolution, digests to keep or clear, freshness, idle detection, and a
//     `plan` that predicts what the commit will do (gone-first removals, renames, NNN reuse, mass-change guard).
//   - SQL: freshness per row (seq), gone-first, bind, upserts, field diffs, activity, the mass-change block.
import {
  date, int, isErr, kasFields, KasFields, kasHash, money, ratio, text,
} from './norm.ts';
import type {
  Cell, ClientRow, CrewRow, FormMissing, KasRow, KeuanganData, RabData, RekapData, RekapRow, Section, SnapTab, Snapshot,
  TabSection,
} from './snapshot.ts';

// ---------- payload (input of public.sheets_commit) ----------

export interface ProjectOut {
  gid: number | null; tab_name: string | null; rekap_name: string | null; seq: number | null; row: number;
  client_code: string | null; client_label: string | null; title: string | null; invoice_no: string | null;
  quote_date: string | null; status: string | null; final_file_date: string | null; payment_due: string | null;
  drive_folder_url: string | null; note_text: string | null; layout?: 'v1' | 'v2';
  money: Record<string, number | string | null>;
}
export interface RabOut {
  gid: number; layout: 'v1' | 'v2'; doc_type: string | null; unlocked_gear: number | null; crew_names: string[];
  client_code: string | null; money: Record<string, unknown>;
}
export type KasOut = KasFields & { row: number; hash: string; replaces?: { row: number | null; hash: string } };
export interface ClientOut {
  row: number; code: string | null; name: string | null; pic: string | null; phone: string | null; email: string | null;
  npwp: string | null; address: string | null; note: string | null;
}
export interface CrewOut {
  row: number; name: string | null; role: string | null; rate: number | null; rate_unit: string | null;
  phone: string | null; note: string | null; unpaid: number | null; paid_this_year: number | null;
}
export interface IssueOut { kind: string; key: string; message: string; detail: Record<string, unknown>; money: boolean }
export interface IssueKey { kind: string; key: string }

export interface CommitPayload {
  seq: number;
  kind: 'snapshot' | 'write';
  source: 'sheet' | 'admin';
  trigger?: 'cron' | 'manual' | 'bridge';
  actor_id?: string | null;
  actor_email?: string | null;
  run_id?: number | null;
  outbox_id?: string | null;
  forced?: boolean;
  force_removals?: boolean;
  complete?: string[];
  meta?: { tabs?: SnapTab[]; bind?: { gid: number; project_id: string }[] };
  clients?: ClientOut[];
  projects?: ProjectOut[];
  rab?: RabOut[];
  kas?: KasOut[];
  kas_removed?: { row: number | null; hash: string }[];
  crew?: CrewOut[];
  values?: Record<string, Record<string, unknown>>;
  issues?: IssueOut[];
  resolved_issue_keys?: IssueKey[];
  digests?: Record<string, string | null>;
  null_digests?: string[];
}

// ---------- what the database already holds ----------

export interface StoredProject {
  id: string; sheet_gid: number | null; tab_name: string | null; seq: number | null;
  sheet_state: 'none' | 'present' | 'removed'; sheet_seq: number | null;
}
export interface StoredKas { id: string; sheet_row: number | null; row_hash: string; sheet_seq: number | null }
export interface Stored {
  last_snapshot_seq: number | null;
  digests: Record<string, string | null>;
  projects: StoredProject[]; // every project that has (or had) a gid
  kas: StoredKas[]; // present Kas rows
  open_issues: (IssueKey & { detail?: Record<string, unknown> | null })[];
  values?: Record<string, unknown>; // stored sheet_values (meta, labels) for idle detection
}

export interface BuildOptions {
  trigger: 'cron' | 'manual' | 'bridge';
  run_id?: number | null;
  force_removals?: boolean;
  expect_sheet?: string;
  expect_env?: string;
}

export interface Plan {
  stale: boolean;
  idle: boolean;
  complete: string[];
  sections: Record<string, 'data' | 'same' | 'unsettled' | 'layout' | 'missing'>;
  tabs: { data: number[]; same: number[]; unsettled: number[]; layout: number[] };
  projects: {
    gone: number[]; new_gids: number[]; renamed: { gid: number; from: string; to: string }[];
    without_tab: string[]; not_in_rekap: number[]; bind: { gid: number; project_id: string }[];
    seq_reused: { seq: number; gid: number; old_gid: number }[];
  };
  kas: { same: number; moved: number; edited: number; inserted: number; removed: number };
  mass_change: { projects: boolean; kas: boolean };
  issues: { open: IssueKey[]; resolve: IssueKey[] };
}

export interface DiffResult {
  skip?: 'busy' | 'stale' | 'wrong_sheet' | 'idle';
  payload: CommitPayload | null;
  plan: Plan;
  warnings: string[];
}

// ---------- helpers ----------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAB_RE = /^\d{3} /;

function sectionState<T>(s: Section<T> | undefined): Plan['sections'][string] {
  if (!s) return 'missing';
  if ('data' in s) return 'data';
  if ('same' in s) return 'same';
  if ('unsettled' in s) return 'unsettled';
  return 'layout';
}

function dataOf<T>(s: Section<T> | undefined): T | null {
  return s && 'data' in s ? s.data : null;
}

function digestOf<T>(s: Section<T> | undefined): string | null {
  return s && 'data' in s ? s.digest : null;
}

function cleanName(v: Cell): string | null {
  return text(v, 100);
}

export function gidFromLink(link: string | null | undefined): number | null {
  const m = /#gid=(\d{1,15})\b/.exec(link || '');
  return m ? Number(m[1]) : null;
}

/** The live tab a Rekap row points at: exact name first (what INDIRECT uses), then the B link's gid. */
export function resolveGid(row: Pick<RekapRow, 'tab_name' | 'b_link'> & { gid?: number | null }, tabs: SnapTab[]): number | null {
  const name = cleanName(row.tab_name);
  if (name) {
    const t = tabs.find((x) => x.name.trim() === name);
    if (t) return t.gid;
  }
  const g = gidFromLink(row.b_link);
  if (g !== null && tabs.some((x) => x.gid === g)) return g;
  if (typeof row.gid === 'number' && tabs.some((x) => x.gid === row.gid)) return row.gid;
  return null;
}

const MONEY_KEYS = ['grand_total', 'dp_amount', 'final_amount', 'dp_received', 'final_received', 'paid_total',
  'outstanding', 'cost_override', 'revenue', 'cost', 'profit'] as const;

/** `liveName` is the tab's current name; it differs from Rekap B (rekap_name) after a tab rename. */
export function projectOut(r: RekapRow, gid: number | null, liveName?: string | null): ProjectOut {
  const rekapName = cleanName(r.tab_name);
  const name = (liveName ? text(liveName, 100) : null) ?? rekapName;
  const inv = text(r.invoice_no, 40);
  const seqFromName = name && /^\d{3}/.test(name) ? Number(name.slice(0, 3)) : null;
  const code = inv ? (/^\d{3}\/([A-Z]{2,5})\/\d{6}$/.exec(inv)?.[1] ?? null) : null;
  const m: Record<string, number | string | null> = {};
  for (const k of MONEY_KEYS) m[k] = money(r[k]);
  m.dp_date = date(r.dp_date);
  m.final_date = date(r.final_date);
  m.pay_status = text(r.pay_status, 30);
  m.margin = ratio(r.margin, 100000);
  m.gear_note = text(r.gear_note, 200);
  return {
    gid, tab_name: name, rekap_name: rekapName, seq: seqFromName, row: r.row,
    client_code: code, client_label: text(r.client_label, 200), title: text(r.title, 200), invoice_no: inv,
    quote_date: date(r.quote_date), status: text(r.status, 30), final_file_date: date(r.final_file_date),
    payment_due: date(r.payment_due), drive_folder_url: text(r.drive_folder_url, 500), note_text: text(r.note_text, 2000),
    money: m,
  };
}

export function rabOut(gid: number, d: RabData): RabOut {
  if (d.layout === 'v1') {
    return {
      gid, layout: 'v1', doc_type: null, unlocked_gear: null, crew_names: [], client_code: null,
      money: { categories: [], crew_lines: [], rab: d },
    };
  }
  const crew = d.crew_lines.map((l) => ({
    row: l.row, person: text(l.person, 120), desc: text(l.desc, 300), cost: money(l.cost), qty: ratio(l.qty, 1e6),
    days: ratio(l.days, 1e6), total: money(l.total),
  }));
  const names = [...new Set(crew.map((l) => l.person).filter((x): x is string => !!x))].sort().slice(0, 100);
  const code = text(d.meta.client_code, 10)?.toUpperCase() ?? null;
  return {
    gid, layout: 'v2', doc_type: text(d.meta.doc_type, 20)?.toUpperCase() ?? null,
    unlocked_gear: int(d.internal.unlocked_gear) ?? d.unlocked ?? null,
    crew_names: names, client_code: code && /^[A-Z]{2,5}$/.test(code) ? code : null,
    money: {
      discount_pct: ratio(d.summary.discount_pct), ppn_pct: ratio(d.summary.ppn_pct), dp_pct: ratio(d.summary.dp_pct),
      pph23_pct: ratio(d.internal.pph23_pct),
      categories: d.summary.categories.map((c) => ({
        no: c.no, label: text(c.label, 80), total: money(c.total), estimate: money(c.estimate), actual: money(c.actual),
      })),
      crew_lines: crew,
      rab: d,
    },
  };
}

export function clientOut(r: ClientRow): ClientOut {
  return {
    row: r.row, code: text(r.code, 40), name: text(r.name, 200), pic: text(r.pic, 200), phone: text(r.phone, 60),
    email: text(r.email, 254), npwp: text(r.npwp, 60), address: text(r.address, 500), note: text(r.note, 1000),
  };
}

export function crewOut(r: CrewRow): CrewOut {
  return {
    row: r.row, name: text(r.name, 120), role: text(r.role, 120), rate: money(r.rate), rate_unit: text(r.rate_unit, 40),
    phone: text(r.phone, 60), note: text(r.note, 1000), unpaid: money(r.unpaid), paid_this_year: money(r.paid_this_year),
  };
}

export function kasOut(r: KasRow): KasOut {
  const f = kasFields(r);
  return { row: r.row, hash: kasHash(f), ...f };
}

// ---------- Kas pairing ----------

export interface KasPair { row: number; how: 'same' | 'moved' | 'edit'; old: StoredKas }
export interface KasMatch { pairs: KasPair[]; inserted: number[]; removed: StoredKas[] }

/**
 * Pair the Sheet's Kas rows with the stored ones. 1) same hash on the same row; 2) only with the whole list:
 * same hash on the nearest row (Hapus RAB shifts, sorts); 3) an unmatched old and new row on the same row
 * = an edit; 4) the rest are new, and (whole list only) unmatched old rows older than this read are removed.
 */
export function pairKas(rows: { row: number; hash: string }[], old: StoredKas[], complete: boolean, seq: number): KasMatch {
  const used = new Set<string>();
  const byRow = new Map<number, KasPair>();
  const oldAt = new Map<number, StoredKas[]>();
  for (const o of old) {
    if (o.sheet_row === null) continue;
    const list = oldAt.get(o.sheet_row) ?? [];
    list.push(o);
    oldAt.set(o.sheet_row, list);
  }
  for (const n of rows) {
    const o = (oldAt.get(n.row) ?? []).find((x) => x.row_hash === n.hash && !used.has(x.id));
    if (o) { used.add(o.id); byRow.set(n.row, { row: n.row, how: 'same', old: o }); }
  }
  if (complete) {
    const cands: { n: number; o: StoredKas; d: number }[] = [];
    for (const n of rows) {
      if (byRow.has(n.row)) continue;
      for (const o of old) {
        if (used.has(o.id) || o.row_hash !== n.hash) continue;
        cands.push({ n: n.row, o, d: Math.abs((o.sheet_row ?? 0) - n.row) });
      }
    }
    cands.sort((a, b) => a.d - b.d || a.n - b.n || (a.o.sheet_row ?? 0) - (b.o.sheet_row ?? 0) || a.o.id.localeCompare(b.o.id));
    for (const c of cands) {
      if (byRow.has(c.n) || used.has(c.o.id)) continue;
      used.add(c.o.id);
      byRow.set(c.n, { row: c.n, how: 'moved', old: c.o });
    }
  }
  for (const n of rows) {
    if (byRow.has(n.row)) continue;
    const o = (oldAt.get(n.row) ?? []).find((x) => !used.has(x.id));
    if (o) { used.add(o.id); byRow.set(n.row, { row: n.row, how: 'edit', old: o }); }
  }
  const inserted = rows.filter((n) => !byRow.has(n.row)).map((n) => n.row);
  const removed = complete ? old.filter((o) => !used.has(o.id) && (o.sheet_seq ?? 0) < seq) : [];
  return { pairs: [...byRow.values()].sort((a, b) => a.row - b.row), inserted, removed };
}

export function massChange(gone: number, present: number, kasRemoved: number, kasPresent: number) {
  return { projects: gone > 2 || (present > 0 && gone * 4 > present), kas: kasRemoved > 5 && kasRemoved * 5 > kasPresent };
}

// ---------- fixed cells ----------

function rekapSummary(d: RekapData) {
  const s = d.summary;
  const counts: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(s.status_counts ?? {})) counts[k] = int(v);
  return {
    count: int(s.count), next_invoice: text(s.next_invoice, 40), deal_value: money(s.deal_value), status_counts: counts,
    tempo_days: int(s.tempo_days), receivable: money(s.receivable), profit_deal: money(s.profit_deal), seq_seed: int(s.seq_seed),
  };
}

function keuanganValue(d: KeuanganData) {
  const line = (l: KeuanganData['total']) => ({
    projects: int(l.projects), omset: money(l.omset), cost: money(l.cost), profit: money(l.profit),
    margin: ratio(l.margin, 100000), money_in: money(l.money_in), receivable: money(l.receivable),
    operational: money(l.operational), net_profit: money(l.net_profit),
  });
  return {
    year: int(d.year), omset: money(d.omset), cost: money(d.cost), profit: money(d.profit), margin: ratio(d.margin, 100000),
    money_in: money(d.money_in), receivable_all: money(d.receivable_all), operational: money(d.operational),
    net_profit: money(d.net_profit), cash: money(d.cash), owed: money(d.owed),
    months: d.months.map((m) => ({ month: m.month, label: text(m.label, 20), ...line(m) })),
    total: line(d.total),
    unpaid: d.unpaid.map((u) => ({
      invoice_no: text(u.invoice_no, 40), client: text(u.client, 200), project: text(u.project, 200),
      grand_total: money(u.grand_total), paid: money(u.paid), outstanding: money(u.outstanding), due: date(u.due),
      pay_status: text(u.pay_status, 30),
    })),
    years: d.years.filter((y) => int(y.year) !== null).map((y) => ({
      year: int(y.year), projects: int(y.projects), omset: money(y.omset), cost: money(y.cost), profit: money(y.profit),
      margin: ratio(y.margin, 100000), money_in: money(y.money_in), net_profit: money(y.net_profit),
    })),
  };
}

// keys sorted: stored values come back from jsonb, which reorders object keys (shorter keys first)
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (x: unknown) => JSON.stringify(x, (_k, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]))
    : v);
  return canon(a) === canon(b);
}

// ---------- issues ----------

const REKAP_PLAIN_COLS = /^[A-FJ-M]\d+$/; // Rekap columns without amounts

function errorIssue(e: { section: string; sheet: string; cell: string; value: string }): IssueOut {
  const money = !(e.section === 'client' || (e.section === 'rekap' && REKAP_PLAIN_COLS.test(e.cell)));
  return {
    kind: 'formula_error', key: `${e.section}!${e.cell}`.slice(0, 200),
    message: `${e.sheet} ${e.cell} shows ${e.value}. The value is left empty in the admin until the Sheet is fixed.`.slice(0, 500),
    detail: { section: e.section, sheet: e.sheet, cell: e.cell, value: e.value }, money,
  };
}

function formIssue(f: FormMissing): IssueOut {
  const r = kasFields(f.row);
  const what = [r.description || r.category || 'Kas entry', r.project_tab ? r.project_tab.slice(0, 3) : 'Operasional', r.entry_date]
    .filter(Boolean).join(' · ');
  return {
    kind: 'form_entry_missing', key: String(f.response_id).slice(0, 200),
    message: `A Kas Form entry didn't reach the Kas tab: ${what}.`.slice(0, 500),
    detail: { response_id: f.response_id, submitted_at: f.submitted_at, row: { ...r, note: r.note ?? 'via Form' } }, money: true,
  };
}

function sectionOfKey(i: IssueKey & { detail?: Record<string, unknown> | null }): string {
  const s = i.detail && typeof i.detail.section === 'string' ? i.detail.section : null;
  return s ?? i.key.split('!')[0];
}

// ---------- snapshot → commit ----------

export function emptyPlan(): Plan {
  return {
    stale: false, idle: false, complete: [], sections: {}, tabs: { data: [], same: [], unsettled: [], layout: [] },
    projects: { gone: [], new_gids: [], renamed: [], without_tab: [], not_in_rekap: [], bind: [], seq_reused: [] },
    kas: { same: 0, moved: 0, edited: 0, inserted: 0, removed: 0 }, mass_change: { projects: false, kas: false },
    issues: { open: [], resolve: [] },
  };
}

export function buildSnapshotCommit(snap: Snapshot, stored: Stored, opts: BuildOptions): DiffResult {
  const plan = emptyPlan();
  const warnings: string[] = [];
  if (snap.skipped === 'busy') return { skip: 'busy', payload: null, plan, warnings };
  const meta = snap.meta;
  if ((opts.expect_sheet && meta.sheet !== opts.expect_sheet) || (opts.expect_env && meta.env !== opts.expect_env)) {
    return { skip: 'wrong_sheet', payload: null, plan, warnings: [`snapshot is from ${meta.env} ${meta.sheet}`] };
  }
  const seq = meta.seq;
  if (!Number.isInteger(seq) || seq < 1) throw new Error('snapshot seq must be a positive whole number');
  if (stored.last_snapshot_seq !== null && seq <= stored.last_snapshot_seq) {
    plan.stale = true;
    return { skip: 'stale', payload: null, plan, warnings };
  }

  const haveTabs = Array.isArray(meta.tabs); // the whole tab list: only then can a tab be "gone"
  const tabs = (haveTabs ? meta.tabs : []).filter((t) => Number.isInteger(t.gid) && TAB_RE.test(t.name));
  const tabGids = new Set(tabs.map((t) => t.gid));
  const p: CommitPayload = {
    seq, kind: 'snapshot', source: 'sheet', trigger: opts.trigger, actor_email: 'Google Sheet',
    run_id: opts.run_id ?? null, force_removals: !!opts.force_removals,
    complete: [], meta: { tabs, bind: [] }, values: {}, issues: [], resolved_issue_keys: [], digests: {}, null_digests: [],
  };
  const complete = p.complete!;
  const nulls = new Set<string>();
  const digests = p.digests!;

  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const) {
    const s = snap[k] as Section<unknown> | undefined;
    const st = sectionState(s);
    plan.sections[k] = st;
    if (st === 'data') {
      digests[k] = digestOf(s);
      if (k !== 'keuangan') complete.push(k);
    } else if (st === 'unsettled' || st === 'layout') {
      nulls.add(k);
    }
  }
  if (haveTabs) complete.push('tabs_index');

  // ---- projects ----
  const present = stored.projects.filter((x) => x.sheet_state === 'present');
  const gone = haveTabs
    ? present.filter((x) => x.sheet_gid !== null && !tabGids.has(x.sheet_gid) && (x.sheet_seq ?? 0) < seq)
    : [];
  plan.projects.gone = gone.map((x) => x.sheet_gid!);
  const rekap = dataOf(snap.rekap);
  if (rekap) {
    p.projects = rekap.rows.filter((r) => cleanName(r.tab_name)).map((r) => {
      const gid = resolveGid(r, tabs);
      const out = projectOut(r, gid, gid === null ? null : tabs.find((t) => t.gid === gid)!.name);
      if (gid === null) plan.projects.without_tab.push(out.rekap_name ?? `row ${r.row}`);
      return out;
    });
    const seen = new Set<number>();
    for (const pr of p.projects) {
      if (pr.gid === null || seen.has(pr.gid)) continue;
      seen.add(pr.gid);
      const live = tabs.find((t) => t.gid === pr.gid)!;
      if (pr.rekap_name && live.name.trim() !== pr.rekap_name) {
        plan.projects.renamed.push({ gid: pr.gid, from: pr.rekap_name, to: live.name });
      }
      const known = stored.projects.find((x) => x.sheet_gid === pr.gid && x.sheet_state === 'present');
      if (!known) {
        plan.projects.new_gids.push(pr.gid);
        const liveSeq = /^\d{3}/.test(live.name) ? Number(live.name.slice(0, 3)) : null;
        const prev = gone.find((x) => x.seq !== null && x.seq === liveSeq);
        if (prev && liveSeq !== null) plan.projects.seq_reused.push({ seq: liveSeq, gid: pr.gid, old_gid: prev.sheet_gid! });
      }
    }
    plan.projects.not_in_rekap = tabs.filter((t) => !seen.has(t.gid)).map((t) => t.gid);
  }
  for (const u of meta.unknown_tabs ?? []) {
    if (u.ccc_project_id && UUID_RE.test(u.ccc_project_id) && tabGids.has(u.gid)) {
      p.meta!.bind!.push({ gid: u.gid, project_id: u.ccc_project_id.toLowerCase() });
    }
  }
  plan.projects.bind = p.meta!.bind!;

  // ---- RAB tabs ----
  const rab: RabOut[] = [];
  for (const t of snap.tabs ?? []) {
    if (!tabGids.has(t.gid)) continue;
    const key = `tab:${t.gid}`;
    if ('data' in t) {
      rab.push(rabOut(t.gid, t.data));
      digests[key] = t.digest;
      plan.tabs.data.push(t.gid);
    } else if ('same' in t) {
      plan.tabs.same.push(t.gid);
    } else if ('unsettled' in t) {
      nulls.add(key);
      plan.tabs.unsettled.push(t.gid);
    } else {
      nulls.add(key);
      plan.tabs.layout.push(t.gid);
    }
  }
  if (rab.length) p.rab = rab;
  for (const k of Object.keys(stored.digests)) {
    const g = /^tab:(\d+)$/.exec(k);
    if (haveTabs && g && !tabGids.has(Number(g[1])) && stored.digests[k] !== null) nulls.add(k);
  }

  // ---- Kas ----
  const kas = dataOf(snap.kas);
  let kasRemovedCount = 0;
  if (kas) {
    const rows = kas.rows.map(kasOut);
    const m = pairKas(rows, stored.kas, true, seq);
    const byRow = new Map(m.pairs.map((x) => [x.row, x]));
    for (const r of rows) {
      const pair = byRow.get(r.row);
      if (pair && pair.how !== 'same') r.replaces = { row: pair.old.sheet_row, hash: pair.old.row_hash };
    }
    p.kas = rows;
    plan.kas = {
      same: m.pairs.filter((x) => x.how === 'same').length, moved: m.pairs.filter((x) => x.how === 'moved').length,
      edited: m.pairs.filter((x) => x.how === 'edit').length, inserted: m.inserted.length, removed: m.removed.length,
    };
    kasRemovedCount = m.removed.length;
  }
  plan.mass_change = massChange(gone.length, present.length, kasRemovedCount, stored.kas.length);
  if (plan.mass_change.kas && !opts.force_removals) nulls.add('kas'); // keep re-reading Kas until confirmed or restored

  // ---- clients, crew ----
  const cl = dataOf(snap.client);
  if (cl) p.clients = cl.rows.map(clientOut).filter((c) => Object.entries(c).some(([k, v]) => k !== 'row' && v !== null));
  const cr = dataOf(snap.crew);
  if (cr) p.crew = cr.rows.map(crewOut).filter((c) => c.name !== null);

  // ---- fixed cells ----
  const values = p.values!;
  const metaValue = { sheet: meta.sheet, env: meta.env, tz: meta.tz, version: meta.version };
  const labelsValue = {
    status: (meta.labels?.status ?? []).map((x) => text(x, 30)).filter(Boolean),
    kas_categories: (meta.labels?.kas_categories ?? []).map((x) => text(x, 80)).filter(Boolean),
  };
  if (!sameJson(stored.values?.meta, metaValue)) values.meta = metaValue;
  if (!sameJson(stored.values?.labels, labelsValue)) values.labels = labelsValue;
  if (rekap) values.rekap_summary = rekapSummary(rekap);
  if (kas) {
    const s = kas.summary;
    values.kas_summary = {
      start_date: date(s.start_date), opening: money(s.opening), in: money(s.in), out: money(s.out),
      cash: money(s.cash), owed: money(s.owed),
    };
  }
  const ku = dataOf(snap.keuangan);
  if (ku) values.keuangan = keuanganValue(ku);

  // ---- issues ----
  const open = new Map(stored.open_issues.map((i) => [`${i.kind}|${i.key}`, i]));
  const issues = p.issues!;
  const nowKeys = new Set<string>();
  for (const e of snap.errors ?? []) {
    const i = errorIssue(e);
    if (nowKeys.has(`${i.kind}|${i.key}`)) continue;
    nowKeys.add(`${i.kind}|${i.key}`);
    issues.push(i);
  }
  const layoutSections: [string, string][] = [];
  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const) {
    const s = snap[k] as Section<unknown> | undefined;
    if (s && 'error' in s) layoutSections.push([k, s.message]);
  }
  for (const t of snap.tabs ?? []) if ('error' in t) layoutSections.push([`tab:${t.gid}`, `${t.name}: ${t.message}`]);
  for (const [section, message] of layoutSections) {
    nowKeys.add(`layout_changed|${section}`);
    issues.push({
      kind: 'layout_changed', key: section, message: (message || `Sync paused for ${section}.`).slice(0, 500),
      detail: { section }, money: false,
    });
  }
  for (const f of snap.form_missing ?? []) {
    const i = formIssue(f);
    nowKeys.add(`${i.kind}|${i.key}`);
    issues.push(i);
  }
  const scanned = new Set(snap.scanned ?? []);
  const okSections = new Set<string>();
  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan']) {
    if (plan.sections[k] === 'data' || plan.sections[k] === 'same') okSections.add(k);
  }
  for (const g of [...plan.tabs.data, ...plan.tabs.same]) okSections.add(`tab:${g}`);
  const kasHashes = new Set((p.kas ?? []).map((r) => r.hash));
  const resolve = p.resolved_issue_keys!;
  for (const i of stored.open_issues) {
    const id = `${i.kind}|${i.key}`;
    if (nowKeys.has(id)) continue;
    const section = sectionOfKey(i);
    const tabGone = haveTabs && /^tab:\d+$/.test(section) && !tabGids.has(Number(section.slice(4)));
    if (i.kind === 'formula_error' && (scanned.has(section) || tabGone)) resolve.push({ kind: i.kind, key: i.key });
    else if (i.kind === 'layout_changed' && (okSections.has(section) || tabGone)) resolve.push({ kind: i.kind, key: i.key });
    else if (i.kind === 'form_entry_missing' && kas && i.detail && typeof i.detail.row === 'object' && i.detail.row) {
      if (kasHashes.has(kasHash(kasFields(i.detail.row as Record<string, Cell>)))) resolve.push({ kind: i.kind, key: i.key });
    }
  }
  plan.issues.open = issues.filter((i) => !open.has(`${i.kind}|${i.key}`)).map((i) => ({ kind: i.kind, key: i.key }));
  plan.issues.resolve = resolve;
  p.null_digests = [...nulls].sort();
  plan.complete = complete;

  // ---- idle: nothing that the commit would change ----
  plan.idle = !rekap && !kas && !cl && !cr && !ku && rab.length === 0 && plan.projects.gone.length === 0 &&
    plan.projects.bind.length === 0 && plan.issues.open.length === 0 && resolve.length === 0 &&
    Object.keys(values).length === 0 && p.null_digests.every((k) => stored.digests[k] === null || stored.digests[k] === undefined);
  if (plan.idle) return { skip: 'idle', payload: p, plan, warnings };

  // empty lists that mean "nothing" are dropped; an empty projects/kas/clients/crew list of a complete
  // section stays, because there it means "the Sheet has none" (everything stored becomes gone)
  for (const k of ['issues', 'resolved_issue_keys', 'null_digests'] as const) if (p[k]?.length === 0) delete p[k];
  if (p.meta && p.meta.bind && p.meta.bind.length === 0) delete p.meta.bind;
  if (Object.keys(values).length === 0) delete p.values;
  if (Object.keys(digests).length === 0) delete p.digests;
  return { payload: p, plan, warnings };
}

// ---------- write-through reply → commit ----------

export interface WriteCtx {
  op: string; seq: number; actor_id: string | null; actor_email: string | null; outbox_id: string;
  forced: boolean; project_id?: string | null; tab_gid?: number | null;
}

/** Records in an Apps Script write reply (see CONTRACT_SNAPSHOT.md, "Write replies"). */
export interface WriteReply {
  seq?: number;
  tab?: SnapTab;
  project?: RekapRow & { gid?: number };
  rab?: TabSection;
  client?: ClientRow | null;
  crew?: CrewRow;
  kas?: KasRow;
  before?: KasRow;
  removed?: KasRow | null;
  [k: string]: unknown;
}

const NULLS_BY_OP: Record<string, string[]> = {
  project_set: ['rekap', 'keuangan'],
  rab_meta: ['rekap', 'keuangan'],
  lock_prices: ['rekap'],
  export_pdf: [],
  create_rab: ['rekap', 'client', 'keuangan'],
  kas_add: ['kas', 'rekap', 'crew', 'keuangan'],
  kas_update: ['kas', 'rekap', 'crew', 'keuangan'],
  kas_delete: ['kas', 'rekap', 'crew', 'keuangan'],
  client_upsert: ['client'],
  crew_upsert: ['crew'],
  // a RAB line or an internal cost moves the tab's totals, so Rekap (grand total, cost, profit) and Keuangan follow
  rab_line_set: ['rekap', 'keuangan'],
  rab_line_add: ['rekap', 'keuangan'],
  rab_line_clear: ['rekap', 'keuangan'],
  rab_internal: ['rekap', 'keuangan'],
};

export function buildWriteCommit(reply: WriteReply, ctx: WriteCtx): CommitPayload {
  const p: CommitPayload = {
    seq: ctx.seq, kind: 'write', source: 'admin', actor_id: ctx.actor_id, actor_email: ctx.actor_email,
    outbox_id: ctx.outbox_id, forced: ctx.forced, meta: {},
  };
  const nulls = new Set(NULLS_BY_OP[ctx.op] ?? []);
  const tabs: SnapTab[] = [];
  if (reply.tab && Number.isInteger(reply.tab.gid)) tabs.push(reply.tab);
  if (reply.project) {
    const gid = (Number.isInteger(reply.project.gid) ? reply.project.gid : null) ?? reply.tab?.gid ?? ctx.tab_gid ?? null;
    if (gid !== null) {
      p.projects = [projectOut(reply.project, gid, reply.tab && reply.tab.gid === gid ? reply.tab.name : null)];
      nulls.add(`tab:${gid}`);
    }
  }
  if (reply.rab && 'data' in reply.rab) {
    p.rab = [rabOut(reply.rab.gid, reply.rab.data)];
    nulls.delete(`tab:${reply.rab.gid}`);
    p.digests = { [`tab:${reply.rab.gid}`]: reply.rab.digest };
  }
  if (ctx.op === 'create_rab' && reply.tab && ctx.project_id && UUID_RE.test(ctx.project_id)) {
    p.meta!.bind = [{ gid: reply.tab.gid, project_id: ctx.project_id }];
  }
  if (reply.client) p.clients = [clientOut(reply.client)];
  if (reply.crew) p.crew = [crewOut(reply.crew)];
  if (reply.kas) {
    const k = kasOut(reply.kas);
    if (reply.before) {
      const b = kasOut(reply.before);
      if (b.hash !== k.hash || b.row !== k.row) k.replaces = { row: b.row, hash: b.hash };
    }
    p.kas = [k];
  }
  if (reply.removed) {
    const r = kasOut(reply.removed);
    p.kas_removed = [{ row: r.row, hash: r.hash }];
  }
  if (tabs.length) p.meta!.tabs = tabs;
  p.null_digests = [...nulls].sort();
  return p;
}

/** Whole-list helpers the Edge Functions use to decide what to ask for. */
export function knownGids(stored: Stored): number[] {
  return [...new Set(stored.projects.map((x) => x.sheet_gid).filter((g): g is number => g !== null))];
}

export function haveDigests(stored: Stored): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(stored.digests)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

export { isErr };
