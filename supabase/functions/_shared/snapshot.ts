// The JSON the Apps Script `snapshot` op returns (the `data` of the doPost reply).
// Documented for people in CONTRACT_SNAPSHOT.md; this file is the machine-checked copy.
//
// Cell values everywhere: number (raw, never formatted), "YYYY-MM-DD" for dates (Asia/Jakarta),
// string for text (as typed, not trimmed), null for an empty cell, {err:"#REF!"} for an error cell.

export type ErrCell = { err: string };
export type Cell = string | number | boolean | null | ErrCell;

export type Section<T> =
  | { digest: string; same: true }
  | { digest: string; data: T }
  | { digest?: string; unsettled: true }
  | { error: 'layout'; message: string };

export interface SnapTab { name: string; gid: number }

export interface SnapMeta {
  sheet: string;
  env: 'dev' | 'prod';
  tz: string;
  version: string;
  seq: number;
  read_at: string;
  tabs: SnapTab[];
  unknown_tabs: { gid: number; ccc_project_id: string | null }[];
  labels: { status: string[]; kas_categories: string[] };
  tabs_mode?: 'none' | 'active' | 'all' | 'list';
}

export interface RekapRow {
  row: number;
  tab_name: Cell; // B, display text
  b_link: string | null; // B rich-text link, e.g. "#gid=2122078196"
  invoice_no: Cell; // C
  client_label: Cell; // D
  title: Cell; // E
  quote_date: Cell; // F
  grand_total: Cell; // G
  dp_amount: Cell; // H
  final_amount: Cell; // I
  status: Cell; // J
  note_text: Cell; // K text
  drive_folder_url: string | null; // K rich-text link
  final_file_date: Cell; // L
  payment_due: Cell; // M
  dp_received: Cell; // N
  dp_date: Cell; // O
  final_received: Cell; // P
  final_date: Cell; // Q
  paid_total: Cell; // R
  outstanding: Cell; // S
  pay_status: Cell; // T
  cost_override: Cell; // U
  revenue: Cell; // V
  cost: Cell; // W
  profit: Cell; // X
  margin: Cell; // Y
  gear_note: Cell; // Z
}

export interface RekapData {
  summary: {
    count: Cell; next_invoice: Cell; deal_value: Cell; status_counts: Record<string, Cell>;
    tempo_days: Cell; receivable: Cell; profit_deal: Cell; seq_seed: Cell;
  };
  rows: RekapRow[];
}

export interface KasRow {
  row: number;
  entry_date: Cell; kind: Cell; category: Cell; project_tab: Cell; description: Cell; counterparty: Cell;
  amount: Cell; paid: Cell; method: Cell; proof_url: Cell; note: Cell;
}

export interface KasData {
  summary: { start_date: Cell; opening: Cell; in: Cell; out: Cell; cash: Cell; owed: Cell };
  rows: KasRow[];
}

export interface ClientRow {
  row: number; name: Cell; code: Cell; pic: Cell; phone: Cell; email: Cell; npwp: Cell; address: Cell; note: Cell;
}

export interface CrewRow {
  row: number; role: Cell; name: Cell; rate: Cell; rate_unit: Cell; phone: Cell; note: Cell;
  unpaid: Cell; paid_this_year: Cell;
}

export interface KeuanganLine {
  projects: Cell; omset: Cell; cost: Cell; profit: Cell; margin: Cell; money_in: Cell;
  receivable: Cell; operational: Cell; net_profit: Cell;
}

export interface KeuanganData {
  year: Cell; omset: Cell; cost: Cell; profit: Cell; margin: Cell; money_in: Cell; receivable_all: Cell;
  operational: Cell; net_profit: Cell; cash: Cell; owed: Cell;
  months: (KeuanganLine & { month: number; label: Cell })[];
  total: KeuanganLine;
  unpaid: { invoice_no: Cell; client: Cell; project: Cell; grand_total: Cell; paid: Cell; outstanding: Cell; due: Cell; pay_status: Cell }[];
  years: { year: Cell; projects: Cell; omset: Cell; cost: Cell; profit: Cell; margin: Cell; money_in: Cell; net_profit: Cell }[];
}

export interface RabLine {
  row: number; no: Cell; desc: Cell; person: Cell; cost: Cell; qty: Cell; unit: Cell; days: Cell; total: Cell;
}

export interface RabEquipLine {
  row: number; item: Cell; qty: Cell; days: Cell; manual_price: Cell; desc: Cell; cost: Cell; unit: Cell;
  total: Cell; vendor: Cell; price_date: Cell;
}

export interface RabDataV2 {
  layout: 'v2';
  meta: {
    doc_type: Cell; title: Cell; client_label: Cell; product: Cell; photographer: Cell; invoice_no: Cell;
    seq: Cell; client_code: Cell; quote_date: Cell; locations: Cell; shooting_days: Cell; usage: Cell;
    location: Cell; language: Cell;
  };
  summary: {
    categories: { no: number; label: Cell; total: Cell; estimate: Cell; actual: Cell }[];
    subtotal: Cell; discount_pct: Cell; discount: Cell; ppn_pct: Cell; ppn: Cell; grand_total: Cell;
    dp_pct: Cell; dp: Cell; final_amount: Cell;
  };
  internal: {
    other_estimate: Cell; other_actual: Cell; cost_estimate: Cell; cost_actual: Cell; omset: Cell;
    profit_estimate: Cell; profit_actual: Cell; margin_estimate: Cell; margin_actual: Cell;
    pph23_pct: Cell; pph23: Cell; net_in: Cell; unlocked_gear: Cell;
  };
  sections: { key: string; title: string; row: number; end_row: number; subtotal: Cell; total_crew?: Cell; lines: RabLine[] }[];
  equipment: { row: number; end_row: number; subtotal: Cell; ppn_bsm: Cell; total: Cell; groups: { name: string; row: number; lines: RabEquipLine[] }[] } | null;
  crew_lines: { row: number; person: Cell; desc: Cell; cost: Cell; qty: Cell; days: Cell; total: Cell }[];
  unlocked: number;
  placeholders: boolean;
}

export interface RabDataV1 {
  layout: 'v1';
  meta: { title: Cell; client_label: Cell; invoice_no: Cell };
  grand_total: Cell;
}

export type RabData = RabDataV2 | RabDataV1;

export type TabSection =
  | { gid: number; name: string; layout: 'v1' | 'v2' | 'unknown'; digest: string; same: true }
  | { gid: number; name: string; layout: 'v1' | 'v2' | 'unknown'; digest: string; data: RabData }
  | { gid: number; name: string; unsettled: true }
  | { gid: number; name: string; error: 'layout'; message: string };

export interface SnapError { section: string; sheet: string; cell: string; value: string }

export interface FormMissing {
  response_id: string;
  submitted_at: string;
  row: Omit<KasRow, 'row'>;
}

export interface Snapshot {
  skipped?: 'busy';
  meta: SnapMeta;
  rekap: Section<RekapData>;
  kas: Section<KasData>;
  client: Section<{ rows: ClientRow[] }>;
  crew: Section<{ rows: CrewRow[] }>;
  keuangan: Section<KeuanganData>;
  tabs: TabSection[];
  scanned: string[]; // sections whose cells were scanned for errors this run (all read ones, incl. "same")
  errors: SnapError[];
  form_missing: FormMissing[] | null;
}

export const SECTIONS = ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const;
export type SectionKey = typeof SECTIONS[number];
