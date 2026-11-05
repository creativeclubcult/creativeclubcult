// Unit tests for supabase/functions/_shared/diff.ts (pure: snapshot + stored state → sheets_commit payload).
// Run: deno test --allow-read supabase/tests/
// Fixtures are synthetic (no real clients or amounts): fixtures/snapshot_base.json is a snapshot one seq
// after fixtures/stored_base.json, with nothing changed except the digests.
import {
  buildSnapshotCommit, buildWriteCommit, kasOut, massChange, pairKas, projectOut, resolveGid,
  type Stored, type StoredKas,
} from '../functions/_shared/diff.ts';
import { kasFields, kasHash } from '../functions/_shared/norm.ts';
import { hmacHex, requestMessage, signRequest, verifyScriptSignature } from '../functions/_shared/hmac.ts';
import { md5Hex } from '../functions/_shared/md5.ts';
import { withoutMoney } from '../functions/_shared/ops.ts';
import type { KasRow, Snapshot } from '../functions/_shared/snapshot.ts';

// ---------- tiny assert helpers (no network imports) ----------
function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}
function ok(v: unknown, msg = 'expected truthy') {
  if (!v) throw new Error(msg);
}

const dir = new URL('./fixtures/', import.meta.url);
const BASE_SNAP: Snapshot = JSON.parse(Deno.readTextFileSync(new URL('snapshot_base.json', dir)));
const BASE_STORED: Stored = JSON.parse(Deno.readTextFileSync(new URL('stored_base.json', dir)));
const snap = (): Snapshot => structuredClone(BASE_SNAP);
const stored = (): Stored => structuredClone(BASE_STORED);
const OPTS = { trigger: 'cron' as const, expect_sheet: BASE_SNAP.meta.sheet, expect_env: 'dev' };
const kasRows = (s: Snapshot) => (s.kas as { data: { rows: KasRow[] } }).data.rows;
const rekapRows = (s: Snapshot) => (s.rekap as { data: { rows: Snapshot extends never ? never : any[] } }).data.rows;
const renumber = (rows: KasRow[], from = 9) => rows.forEach((r, i) => (r.row = from + i));

// ---------- fixtures are consistent ----------
Deno.test('fixtures: stored Kas hashes equal the hashes of the base snapshot rows', () => {
  const s = snap();
  eq(kasRows(s).map((r) => kasOut(r).hash), stored().kas.map((k) => k.row_hash));
});

// ---------- freshness / seq ----------
Deno.test('freshness: a snapshot whose seq is not above last_snapshot_seq is skipped as stale', () => {
  for (const seq of [99, 100]) {
    const s = snap();
    s.meta.seq = seq;
    const r = buildSnapshotCommit(s, stored(), OPTS);
    eq(r.skip, 'stale', `seq ${seq}`);
    eq(r.payload, null);
    ok(r.plan.stale);
  }
});

Deno.test('freshness: seq 101 after 100 is committed, payload carries seq and kind snapshot', () => {
  const r = buildSnapshotCommit(snap(), stored(), OPTS);
  eq(r.skip, undefined);
  eq(r.payload!.seq, 101);
  eq(r.payload!.kind, 'snapshot');
  eq(r.payload!.source, 'sheet');
});

Deno.test('freshness: first import (no last_snapshot_seq) is committed', () => {
  const st = stored();
  st.last_snapshot_seq = null;
  const s = snap();
  s.meta.seq = 1;
  eq(buildSnapshotCommit(s, st, OPTS).skip, undefined);
});

Deno.test('freshness: seq must be a positive whole number', () => {
  for (const bad of [0, -1, 1.5]) {
    const s = snap();
    s.meta.seq = bad;
    let threw = false;
    try { buildSnapshotCommit(s, stored(), OPTS); } catch { threw = true; }
    ok(threw, `seq ${bad} should throw`);
  }
});

Deno.test('freshness: busy snapshot and a snapshot from another sheet/env are skipped', () => {
  const b = snap();
  b.skipped = 'busy';
  eq(buildSnapshotCommit(b, stored(), OPTS).skip, 'busy');
  const w = snap();
  w.meta.sheet = 'OTHER';
  eq(buildSnapshotCommit(w, stored(), OPTS).skip, 'wrong_sheet');
  const e = snap();
  e.meta.env = 'prod';
  eq(buildSnapshotCommit(e, stored(), OPTS).skip, 'wrong_sheet');
});

Deno.test('freshness: Kas rows written by a newer write (sheet_seq >= seq) are never removed', () => {
  const st = stored();
  st.kas[7].sheet_seq = 105; // row 16 was just written by the admin (seq 105) after this read (seq 101)
  const s = snap();
  kasRows(s).pop(); // the read doesn't have it yet
  const r = buildSnapshotCommit(s, st, OPTS);
  eq(r.plan.kas.removed, 0);
});

Deno.test('freshness: a project written by a newer write is not gone even if this read misses its tab', () => {
  const st = stored();
  st.projects[3].sheet_seq = 105;
  const s = snap();
  s.meta.tabs = s.meta.tabs.filter((t) => t.gid !== 1004);
  eq(buildSnapshotCommit(s, st, OPTS).plan.projects.gone, []);
});

// ---------- idle ----------
Deno.test('idle: every section the same and nothing to resolve → skip idle', () => {
  const s = snap();
  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const) {
    (s as unknown as Record<string, unknown>)[k] = { digest: `${k}-101`, same: true };
  }
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.skip, 'idle');
});

Deno.test('idle: stored meta read back from jsonb (keys reordered) is still the same → skip idle', () => {
  const s = snap();
  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const) {
    (s as unknown as Record<string, unknown>)[k] = { digest: `${k}-101`, same: true };
  }
  const st = stored();
  const m = st.values!.meta as Record<string, unknown>;
  st.values!.meta = { tz: m.tz, env: m.env, sheet: m.sheet, version: m.version }; // jsonb order: shorter keys first
  eq(buildSnapshotCommit(s, st, OPTS).skip, 'idle');
});

Deno.test('idle: changed labels make the run not idle and only then send labels', () => {
  const s = snap();
  for (const k of ['rekap', 'kas', 'client', 'crew', 'keuangan'] as const) {
    (s as unknown as Record<string, unknown>)[k] = { digest: `${k}-101`, same: true };
  }
  s.meta.labels.status = [...s.meta.labels.status, 'Ditunda'];
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.skip, undefined);
  eq(Object.keys(r.payload!.values!), ['labels']);
});

Deno.test('payload: complete sections, digests kept for data sections, same sections not resent', () => {
  const r = buildSnapshotCommit(snap(), stored(), OPTS);
  const p = r.payload!;
  eq(p.complete, ['rekap', 'kas', 'client', 'crew', 'tabs_index']);
  eq(p.digests, { rekap: 'rekap-102', kas: 'kas-102', client: 'client-102', crew: 'crew-102' });
  eq(p.null_digests, undefined);
  eq(p.projects!.length, 4);
  eq(p.kas!.length, 8);
  eq(p.clients!.length, 3, 'the empty client row is dropped');
  eq(p.crew!.length, 2, 'the empty crew row is dropped');
  eq(Object.keys(p.values!).sort(), ['kas_summary', 'rekap_summary'], 'meta/labels unchanged → not sent; keuangan same');
  eq(p.values!.rekap_summary.receivable, 12500000);
  eq(p.values!.kas_summary.owed, 1500000);
});

// ---------- Kas pairing ----------
Deno.test('kas: unchanged rows pair on the same row, no replaces hints', () => {
  const r = buildSnapshotCommit(snap(), stored(), OPTS);
  eq(r.plan.kas, { same: 8, moved: 0, edited: 0, inserted: 0, removed: 0 });
  ok(r.payload!.kas!.every((k) => k.replaces === undefined));
});

Deno.test('kas: a row inserted in the middle shifts the rest → moved by hash to the nearest row, one insert', () => {
  const s = snap();
  const rows = kasRows(s);
  rows.splice(3, 0, { ...rows[0], description: 'Uang makan', amount: 200000, kind: 'Keluar', category: 'Transport' });
  renumber(rows);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  // old rows 13 and 14 are identical ("Bensin"): after the shift, new row 14 equals old row 14 → same
  eq(r.plan.kas, { same: 4, moved: 4, edited: 0, inserted: 1, removed: 0 });
  const k = r.payload!.kas!;
  eq(k[3].replaces, undefined, 'the new row has no hint');
  eq(k[4].replaces, { row: 12, hash: stored().kas[3].row_hash }, 'old row 12 is now row 13');
  eq(k[8].replaces, { row: 16, hash: stored().kas[7].row_hash });
});

Deno.test('kas: Hapus RAB deletes a row → the rest move up, exactly the deleted row is removed', () => {
  const s = snap();
  const rows = kasRows(s);
  rows.splice(2, 1); // old row 11
  renumber(rows);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.kas, { same: 3, moved: 4, edited: 0, inserted: 0, removed: 1 }, 'identical rows 13/14 keep a same pair');
  const m = pairKas(r.payload!.kas!, stored().kas, true, 101);
  eq(m.removed.map((x) => x.sheet_row), [11]);
});

Deno.test('kas: an edited cell on the same row is an edit with a replaces hint to the old content', () => {
  const s = snap();
  kasRows(s)[1].amount = 1750000; // row 10
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.kas, { same: 7, moved: 0, edited: 1, inserted: 0, removed: 0 });
  eq(r.payload!.kas![1].replaces, { row: 10, hash: stored().kas[1].row_hash });
});

Deno.test('kas: identical rows (same hash) pair with the nearest old row; the far one is removed', () => {
  const old: StoredKas[] = [
    { id: 'a', sheet_row: 13, row_hash: 'H', sheet_seq: 1 },
    { id: 'b', sheet_row: 14, row_hash: 'H', sheet_seq: 1 },
    { id: 'c', sheet_row: 30, row_hash: 'H', sheet_seq: 1 },
  ];
  // two identical rows remain, shifted up by one (rows 12, 13)
  const m = pairKas([{ row: 12, hash: 'H' }, { row: 13, hash: 'H' }], old, true, 2);
  eq(m.pairs.map((p) => [p.row, p.old.id, p.how]), [[12, 'b', 'moved'], [13, 'a', 'same']]);
  eq(m.removed.map((x) => x.id), ['c']);
});

Deno.test('kas: a sort keeps every row (moved), nothing inserted or removed', () => {
  const s = snap();
  const rows = kasRows(s).reverse();
  renumber(rows);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.kas.inserted, 0);
  eq(r.plan.kas.removed, 0);
  eq(r.plan.kas.same + r.plan.kas.moved, 8);
});

Deno.test('kas: without the whole list there is no moved pass and no removal', () => {
  const old = stored().kas;
  const m = pairKas([{ row: 9, hash: old[1].row_hash }], old, false, 101);
  eq(m.pairs.map((p) => p.how), ['edit'], 'same row, other content → edit (no hash search)');
  eq(m.removed, []);
});

Deno.test('kas: the TS hash equals Postgres md5(jsonb_build_array(...)::text) (values checked on DEV)', () => {
  // SELECT md5(jsonb_build_array('2026-11-04'::date, 'Keluar', 'Fee Crew', '011 ACME - Photoshoot Campaign',
  //   E'Fee "DOP" \\ tést ünï 💥\nline\ttab', null::text, 1500000::bigint, 'Belum', 'Transfer', null::text, 'via Admin')::text)
  eq(kasHash(kasFields({
    entry_date: '2026-11-04', kind: 'Keluar', category: 'Fee Crew', project_tab: '011 ACME - Photoshoot Campaign',
    description: 'Fee "DOP" \\ tést ünï 💥\nline\ttab', counterparty: null, amount: 1500000, paid: 'Belum',
    method: 'Transfer', proof_url: null, note: 'via Admin',
  })), '3b3ee2b03174586c3790424298d7cc13');
  eq(kasHash(kasFields({
    entry_date: '2026-11-03', kind: 'Masuk', category: 'Pemasukan Lain', project_tab: null, description: '  spaced ',
    counterparty: 'Budi', amount: 250000, paid: 'Sudah', method: 'QRIS', proof_url: 'https://drive.google.com/x?a=1&b=2',
    note: '',
  })), 'bdd79698902dad11b8d02406dcf988f3');
});

Deno.test('kas: serial dates and dd/mm/yyyy normalise to the same hash as ISO dates', () => {
  const base = kasRows(snap())[0];
  const h = kasOut(base).hash;
  eq(kasOut({ ...base, entry_date: 46297 }).hash, h, 'serial 46297 = 2026-10-02');
  eq(kasOut({ ...base, entry_date: '02/10/2026' }).hash, h);
  eq(kasOut({ ...base, amount: '7500000' }).hash, h, 'numeric text');
});

// ---------- gone-first project removal ----------
Deno.test('gone: a tab deleted (Hapus RAB) with its Rekap row → gone, its tab digest cleared', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.filter((t) => t.gid !== 1003);
  (s.rekap as any).data.rows = rekapRows(s).filter((r: any) => r.row !== 8);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.projects.gone, [1003]);
  ok(r.payload!.complete!.includes('tabs_index'), 'tabs_index lets the SQL mark it gone');
  ok(!r.payload!.projects!.some((p) => p.gid === 1003));
  eq(r.payload!.null_digests, ['tab:1003']);
  eq(r.plan.mass_change.projects, false);
});

Deno.test('gone: without a tab list nothing can be gone (no tabs_index)', () => {
  const s = snap();
  (s.meta as any).tabs = undefined;
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.projects.gone, []);
  ok(!r.payload!.complete!.includes('tabs_index'));
});

Deno.test('gone: an empty Rekap is still sent as an empty list (it means "none"), not dropped', () => {
  const s = snap();
  (s.rekap as any).data.rows = [];
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.payload!.projects, []);
});

// ---------- NNN reuse ----------
Deno.test('NNN reuse: delete the newest TST tab and create a new one with the same number → old gone, new gid', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.filter((t) => t.gid !== 1003).concat([{ name: '003 TST - Second Test', gid: 2003 }]);
  const row = rekapRows(s).find((r: any) => r.row === 8);
  row.tab_name = '003 TST - Second Test';
  row.b_link = '#gid=2003';
  row.title = 'Second Test';
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.projects.gone, [1003]);
  eq(r.plan.projects.new_gids, [2003]);
  eq(r.plan.projects.seq_reused, [{ seq: 3, gid: 2003, old_gid: 1003 }]);
  const p = r.payload!.projects!.find((x) => x.row === 8)!;
  eq([p.gid, p.seq, p.tab_name], [2003, 3, '003 TST - Second Test']);
});

Deno.test('NNN reuse: a stale #gid link to the deleted tab never revives it (name wins)', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.filter((t) => t.gid !== 1003).concat([{ name: '003 TST - Test Shoot', gid: 2003 }]);
  // same name, Rekap B link still points at the deleted gid
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.payload!.projects!.find((x) => x.row === 8)!.gid, 2003);
  eq(r.plan.projects.gone, [1003]);
});

// ---------- tab rename ----------
Deno.test('rename: a renamed tab keeps its gid via the B link; tab_name = live name, rekap_name = B text', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.map((t) => t.gid === 1002 ? { ...t, name: '002 BETA - Campaign v2' } : t);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  const p = r.payload!.projects!.find((x) => x.row === 7)!;
  eq([p.gid, p.tab_name, p.rekap_name], [1002, '002 BETA - Campaign v2', '002 BETA - Campaign']);
  eq(r.plan.projects.renamed, [{ gid: 1002, from: '002 BETA - Campaign', to: '002 BETA - Campaign v2' }]);
  eq(r.plan.projects.gone, []);
  eq(r.plan.projects.new_gids, []);
});

Deno.test('rename: without a link the row has no tab (rekap_without_tab) and the tab is not in Rekap', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.map((t) => t.gid === 1002 ? { ...t, name: '002 BETA - Campaign v2' } : t);
  rekapRows(s).find((r: any) => r.row === 7).b_link = null;
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.projects.without_tab, ['002 BETA - Campaign']);
  eq(r.plan.projects.not_in_rekap, [1002]);
  eq(r.payload!.projects!.find((x) => x.row === 7)!.gid, null);
});

Deno.test('resolveGid: exact (trimmed) name first, then link, then explicit gid; only live tabs', () => {
  const tabs = [{ name: '001 A', gid: 1 }, { name: '002 B', gid: 2 }];
  eq(resolveGid({ tab_name: ' 001 A ', b_link: '#gid=2' }, tabs), 1);
  eq(resolveGid({ tab_name: 'gone', b_link: 'https://docs.google.com/x#gid=2' }, tabs), 2);
  eq(resolveGid({ tab_name: 'gone', b_link: '#gid=9' }, tabs), null);
  eq(resolveGid({ tab_name: 'gone', b_link: null, gid: 2 }, tabs), 2);
});

// ---------- mass-change guard ----------
Deno.test('mass change: thresholds match the SQL guard', () => {
  eq(massChange(2, 12, 0, 0).projects, false);
  eq(massChange(3, 12, 0, 0).projects, true, '> 2 gone');
  eq(massChange(1, 3, 0, 0).projects, true, 'more than a quarter');
  eq(massChange(0, 0, 0, 0).projects, false);
  eq(massChange(0, 0, 5, 6).kas, false, '≤ 5 removed is never mass');
  eq(massChange(0, 0, 6, 30).kas, false, 'exactly a fifth is not mass');
  eq(massChange(0, 0, 6, 29).kas, true);
});

Deno.test('mass change: 3 project tabs disappear → predicted; force_removals still predicts but SQL decides', () => {
  const s = snap();
  s.meta.tabs = s.meta.tabs.slice(0, 1);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.projects.gone, [1002, 1003, 1004]);
  eq(r.plan.mass_change.projects, true);
  eq(r.payload!.force_removals, false);
  eq(buildSnapshotCommit(s, stored(), { ...OPTS, force_removals: true }).payload!.force_removals, true);
});

Deno.test('mass change: most Kas rows vanish → kas digest cleared so Kas is re-read until confirmed', () => {
  const s = snap();
  (s.kas as any).data.rows = kasRows(s).slice(0, 2);
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.plan.kas.removed, 6);
  eq(r.plan.mass_change.kas, true);
  ok(r.payload!.null_digests!.includes('kas'));
  const f = buildSnapshotCommit(s, stored(), { ...OPTS, force_removals: true });
  ok(!(f.payload!.null_digests ?? []).includes('kas'), 'confirmed → no re-read');
});

// ---------- formula error cells ----------
Deno.test('formula errors: one issue per cell, money flag by column, error cells become null', () => {
  const s = snap();
  s.errors = [
    { section: 'rekap', sheet: 'Rekap Project', cell: 'G7', value: '#REF!' },
    { section: 'rekap', sheet: 'Rekap Project', cell: 'G7', value: '#REF!' },
    { section: 'rekap', sheet: 'Rekap Project', cell: 'J7', value: '#N/A' },
    { section: 'client', sheet: 'Client', cell: 'B6', value: '#NAME?' },
  ];
  const row = rekapRows(s).find((r: any) => r.row === 7);
  row.grand_total = { err: '#REF!' };
  row.status = { err: '#N/A' };
  const r = buildSnapshotCommit(s, stored(), OPTS);
  const iss = r.payload!.issues!;
  eq(iss.map((i) => [i.kind, i.key, i.money]), [
    ['formula_error', 'rekap!G7', true], ['formula_error', 'rekap!J7', false], ['formula_error', 'client!B6', false],
  ]);
  ok(!/[0-9]{4,}/.test(iss[0].message), 'no amounts in the message');
  const p = r.payload!.projects!.find((x) => x.row === 7)!;
  eq([p.money.grand_total, p.status], [null, null]);
});

Deno.test('formula errors: an open issue resolves when its section was scanned and the error is gone', () => {
  const st = stored();
  st.open_issues = [
    { kind: 'formula_error', key: 'kas!H12', detail: { section: 'kas' } },
    { kind: 'formula_error', key: 'keuangan!D5', detail: { section: 'keuangan' } },
    { kind: 'formula_error', key: 'tab:1003!H34', detail: { section: 'tab:1003' } },
  ];
  const s = snap();
  s.scanned = ['rekap', 'kas', 'client', 'crew']; // keuangan not scanned this run
  s.meta.tabs = s.meta.tabs.filter((t) => t.gid !== 1003); // its tab was deleted
  const r = buildSnapshotCommit(s, st, OPTS);
  eq(r.payload!.resolved_issue_keys, [
    { kind: 'formula_error', key: 'kas!H12' }, { kind: 'formula_error', key: 'tab:1003!H34' },
  ]);
});

Deno.test('formula errors: a still-present error is refreshed, not resolved', () => {
  const st = stored();
  st.open_issues = [{ kind: 'formula_error', key: 'rekap!G7', detail: { section: 'rekap' } }];
  const s = snap();
  s.errors = [{ section: 'rekap', sheet: 'Rekap Project', cell: 'G7', value: '#REF!' }];
  const r = buildSnapshotCommit(s, st, OPTS);
  eq(r.payload!.resolved_issue_keys, undefined);
  eq(r.plan.issues.open, [], 'already open → not counted as new');
});

// ---------- layout, unsettled, bind, form ----------
Deno.test('layout: a section with a changed layout is paused (no data, digest cleared, issue opened)', () => {
  const s = snap();
  (s as any).rekap = { error: 'layout', message: 'Rekap Project header row changed (expected "No. Invoice" in C5).' };
  const r = buildSnapshotCommit(s, stored(), OPTS);
  ok(!r.payload!.complete!.includes('rekap'));
  eq(r.payload!.projects, undefined);
  ok(r.payload!.null_digests!.includes('rekap'));
  eq(r.payload!.issues!.map((i) => [i.kind, i.key]), [['layout_changed', 'rekap']]);
});

Deno.test('layout: an open layout issue resolves when the section reads again', () => {
  const st = stored();
  st.open_issues = [{ kind: 'layout_changed', key: 'rekap', detail: { section: 'rekap' } }];
  eq(buildSnapshotCommit(snap(), st, OPTS).payload!.resolved_issue_keys, [{ kind: 'layout_changed', key: 'rekap' }]);
});

Deno.test('unsettled: a section read mid-edit is not complete and its digest is cleared', () => {
  const s = snap();
  (s as any).kas = { unsettled: true };
  const r = buildSnapshotCommit(s, stored(), OPTS);
  ok(!r.payload!.complete!.includes('kas'));
  eq(r.payload!.kas, undefined);
  ok(r.payload!.null_digests!.includes('kas'));
});

Deno.test('RAB tabs: data → rab entry + digest; unsettled → digest cleared', () => {
  const s = snap();
  s.tabs = [
    { gid: 1001, name: '001 ACME - Lookbook', layout: 'v1', digest: 'tab-1001-b',
      data: { layout: 'v1', meta: { title: 'Lookbook', client_label: 'PT Acme Indonesia', invoice_no: '001/ACME/261001' }, grand_total: 15000000 } },
    { gid: 1002, name: '002 BETA - Campaign', unsettled: true },
  ];
  const r = buildSnapshotCommit(s, stored(), OPTS);
  eq(r.payload!.rab!.map((x) => [x.gid, x.layout]), [[1001, 'v1']]);
  eq(r.payload!.digests!['tab:1001'], 'tab-1001-b');
  ok(r.payload!.null_digests!.includes('tab:1002'));
});

Deno.test('bind: a tab made from the admin carries ccc_project_id → meta.bind', () => {
  const s = snap();
  s.meta.unknown_tabs = [
    { gid: 1004, ccc_project_id: 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE' },
    { gid: 1004, ccc_project_id: 'not-a-uuid' },
    { gid: 9999, ccc_project_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  ];
  eq(buildSnapshotCommit(s, stored(), OPTS).payload!.meta!.bind, [
    { gid: 1004, project_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
  ]);
});

Deno.test('form: a Form entry missing from Kas opens an issue; it resolves once the row exists', () => {
  const s = snap();
  const { row: _r, ...entry } = { ...kasRows(s)[4], description: 'Parkir', amount: 20000 };
  s.form_missing = [{ response_id: 'resp-1', submitted_at: '2026-11-04T02:00:00Z', row: entry }];
  const r = buildSnapshotCommit(s, stored(), OPTS);
  const i = r.payload!.issues!.find((x) => x.kind === 'form_entry_missing')!;
  eq([i.key, i.money], ['resp-1', true]);
  const st = stored();
  st.open_issues = [{ kind: 'form_entry_missing', key: 'resp-1', detail: i.detail }];
  const s2 = snap();
  kasRows(s2).push({ ...entry, row: 17, note: 'via Form' });
  eq(buildSnapshotCommit(s2, st, OPTS).payload!.resolved_issue_keys, [{ kind: 'form_entry_missing', key: 'resp-1' }]);
});

// ---------- write replies ----------
const CTX = { seq: 120, actor_id: null, actor_email: 'admin@test', outbox_id: '11111111-1111-4111-8111-111111111111', forced: false };

Deno.test('write: project_set → one project, rekap/keuangan and its tab digest cleared', () => {
  const row = rekapRows(snap())[1];
  const p = buildWriteCommit({ seq: 120, project: row }, { ...CTX, op: 'project_set', tab_gid: 1002 });
  eq([p.kind, p.seq, p.projects![0].gid], ['write', 120, 1002]);
  eq(p.null_digests, ['keuangan', 'rekap', 'tab:1002']);
});

Deno.test('write: kas_update sends replaces from `before`; kas_delete sends kas_removed', () => {
  const rows = kasRows(snap());
  const after = { ...rows[1], amount: 1750000 };
  const u = buildWriteCommit({ seq: 121, kas: after, before: rows[1] }, { ...CTX, op: 'kas_update' });
  eq(u.kas![0].replaces, { row: 10, hash: stored().kas[1].row_hash });
  const d = buildWriteCommit({ seq: 122, removed: rows[2] }, { ...CTX, op: 'kas_delete' });
  eq(d.kas_removed, [{ row: 11, hash: stored().kas[2].row_hash }]);
  eq(d.kas, undefined, 'a write never sends a whole Kas list');
});

Deno.test('write: create_rab binds the new tab to the Brief and uses the RAB data digest', () => {
  const s = snap();
  const row = { ...rekapRows(s)[3], row: 10, tab_name: '005 ACME - New', b_link: '#gid=3005' };
  const p = buildWriteCommit({
    seq: 123, tab: { name: '005 ACME - New', gid: 3005 }, project: row,
    rab: { gid: 3005, name: '005 ACME - New', layout: 'v1', digest: 'tab-3005-a', data: { layout: 'v1', meta: { title: 'New', client_label: 'PT Acme Indonesia', invoice_no: null }, grand_total: null } },
  }, { ...CTX, op: 'create_rab', project_id: '22222222-2222-4222-8222-222222222222' });
  eq(p.meta!.bind, [{ gid: 3005, project_id: '22222222-2222-4222-8222-222222222222' }]);
  eq(p.digests, { 'tab:3005': 'tab-3005-a' });
  ok(!p.null_digests!.includes('tab:3005'));
  eq(p.projects![0].tab_name, '005 ACME - New');
});

Deno.test('projectOut: client code from the invoice number, seq from the live tab name', () => {
  const p = projectOut(rekapRows(snap())[0], 1001, '001 ACME - Lookbook (final)');
  eq([p.client_code, p.seq, p.tab_name, p.rekap_name], ['ACME', 1, '001 ACME - Lookbook (final)', '001 ACME - Lookbook']);
  eq([p.money.margin, p.money.dp_date], [0.4, '2026-10-02']);
});

// ---------- signatures (shared with Sync.gs) ----------
Deno.test('hmac: request message layout and signature round trip', async () => {
  const r = await signRequest('k'.repeat(40), { sheet: 'S', op: 'ping', args: { a: 1 }, ts: 1700000000, nonce: 'n1' });
  eq(requestMessage(r), `1\n1700000000\nn1\nS\nping\n\n1\n{"a":1}`);
  eq(r.sig, await hmacHex('k'.repeat(40), requestMessage(r)));
  eq(await hmacHex('key', 'The quick brown fox jumps over the lazy dog'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8', 'RFC test vector');
});

Deno.test('hmac: script signature checks time window and signature', async () => {
  const secret = 's'.repeat(40);
  const body = '{"kind":"hello"}';
  const now = 1700000000;
  const sig = await hmacHex(secret, `${now}.${body}`);
  eq(await verifyScriptSignature(secret, String(now), sig, body, now), 'ok');
  eq(await verifyScriptSignature(secret, null, null, body, now), 'unsigned');
  eq(await verifyScriptSignature(secret, String(now - 301), await hmacHex(secret, `${now - 301}.${body}`), body, now), 'stale');
  eq(await verifyScriptSignature(secret, String(now), sig, body + ' ', now), 'bad_sig');
});

Deno.test('md5: RFC 1321 vectors', () => {
  eq(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  eq(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  eq(md5Hex('The quick brown fox jumps over the lazy dog'), '9e107d9d372bb6826bd81d3542a419d6');
});

Deno.test('withoutMoney: a reply keeps the plain project fields and drops the RAB, Kas, crew and PDF', () => {
  const reply = {
    locked: 2, written: ['G20', 'G21'], noop: [], tab: { name: '010 Sample', gid: 7 }, invoice_no: '010/SMP/281026',
    project: { row: 12, gid: 7, tab_name: '010 Sample', title: 'Campaign', status: 'Draft', quote_date: '2026-10-28',
      grand_total: 12000000, dp_amount: 6000000, paid_total: 0, outstanding: 0, revenue: 12000000, cost: 9000000,
      profit: 3000000, margin: 0.25, gear_note: 'Lens Rp 500.000', pay_status: 'Belum' },
    rab: { gid: 7, data: { lines: [{ desc: 'Photographer', total: 1500000 }] } },
    kas: { amount: 500000 }, crew: { rate: 1500000 }, file: { id: 'x', url: 'https://drive.google.com/x' },
    folder_url: 'https://drive.google.com/f', removed: { amount: 1 }, totals: { omset: 1 },
  };
  eq(withoutMoney(reply), {
    locked: 2, written: ['G20', 'G21'], noop: [], tab: { name: '010 Sample', gid: 7 }, invoice_no: '010/SMP/281026',
    project: { row: 12, gid: 7, tab_name: '010 Sample', title: 'Campaign', status: 'Draft', quote_date: '2026-10-28' },
  });
  eq(withoutMoney({ client: { code: 'SMP', name: 'Sample' }, written: ['name'] }), { client: { code: 'SMP', name: 'Sample' }, written: ['name'] });
  eq(withoutMoney({ project: null, rab: { data: {} } }), {});
});
