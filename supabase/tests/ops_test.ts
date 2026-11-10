// The admin → Sheet op checks for RAB lines (M6) in supabase/functions/_shared/ops.ts, and what their Sheet replies
// commit. Run: deno test --allow-read supabase/tests/
import { buildWriteCommit } from '../functions/_shared/diff.ts';
import { friendly, OPS } from '../functions/_shared/ops.ts';

function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}

const PID = '33333333-3333-4333-8333-333333333333';
const OP = '44444444-4444-4444-8444-444444444444';
const run = (op: string, a: Record<string, unknown>) => OPS[op].check({ project_id: PID, ...a }, OP);
const err = (op: string, a: Record<string, unknown>) => {
  const r = run(op, a);
  return r.ok ? 'ok' : r.error;
};

Deno.test('M6: the four line ops are on, for editors, as money changes on the project', () => {
  for (const op of ['rab_line_set', 'rab_line_add', 'rab_line_clear', 'rab_internal']) {
    eq([OPS[op].enabled, OPS[op].perm, OPS[op].milestone], [true, 'edit', 'M6'], op);
  }
  const r = run('rab_line_set', { section: 'pre', lines: [{ row: 66, set: { cost: 500000 }, expect: { desc: 'Moodboard', cost: 400000 } }] });
  eq(r, {
    ok: true, args: { project_id: PID, section: 'pre', lines: [{ row: 66, set: { cost: 500000 }, expect: { desc: 'Moodboard', cost: 400000 } }], force: false },
    target: `project:${PID}`, projectId: PID, money: true,
  });
});

Deno.test('M6 rab_line_set: each section takes only its own columns', () => {
  const set = (section: string, s: Record<string, unknown>) => err('rab_line_set', { section, lines: [{ row: 70, set: s }] });
  eq(set('crew', { person: 'Andi' }), 'ok');
  eq(set('pre', { person: 'Andi' }), "person can't be changed from the admin.");
  eq(set('talent', { unit: 'Org' }), "unit can't be changed from the admin.", 'talent F is the Person spill');
  eq(set('pre', { total: 5 }), "total can't be changed from the admin.", 'H is the formula');
  eq(set('equipment', { desc: 'x' }), "desc can't be changed from the admin.", 'gear B is the formula');
  eq(set('nope', { desc: 'x' }), 'Pick a section.');
  eq(set('pre', { desc: '' }), 'Use Remove line to take a line out.');
  eq(set('equipment', { item: null }), 'Use Remove line to take a line out.');
  eq(set('pre', {}), 'Nothing to change.');
});

Deno.test('M6 rab_line_set: values like the Sheet takes them', () => {
  const set = (section: string, s: Record<string, unknown>) => err('rab_line_set', { section, lines: [{ row: 70, set: s }] });
  eq([set('pre', { qty: 1.5 }), set('pre', { days: 0.25 }), set('pre', { qty: 0 }), set('pre', { cost: 0 })], ['ok', 'ok', 'ok', 'ok']);
  eq(set('pre', { qty: 1.234 }), 'qty must be a number with at most 2 decimals.');
  eq(set('pre', { qty: -1 }), 'qty must be a number with at most 2 decimals.');
  eq(set('pre', { qty: '2' }), 'qty must be a number with at most 2 decimals.');
  eq(set('pre', { cost: 10.5 }), 'cost must be a whole amount in Rupiah.');
  eq(set('pre', { no: 1.5 }), 'no must be a whole number from 0 to 999.');
  eq(set('pre', { desc: 'x'.repeat(501) }), 'desc is longer than 500 characters.');
  eq([set('equipment', { qty: 1 }), set('equipment', { days: 30 })], ['ok', 'ok']);
  eq(set('equipment', { qty: 31 }), 'qty must be a whole number from 1 to 30.');
  eq(set('equipment', { days: 0 }), 'days must be a whole number from 1 to 30.');
  eq(set('equipment', { qty: 1.5 }), 'qty must be a whole number from 1 to 30.');
  const r = run('rab_line_set', { section: 'pre', lines: [{ row: 70, set: { desc: '  Retouch  ', unit: null } }] });
  eq(r.ok && (r.args.lines as { set: unknown }[])[0].set, { desc: 'Retouch', unit: null }, 'text trimmed, null clears');
});

Deno.test('M6 rab_line_set: rows, batches and expect keys', () => {
  const lines = (l: unknown) => err('rab_line_set', { section: 'pre', lines: l });
  eq(lines([]), 'Send 1 to 40 lines.');
  eq(lines(Array.from({ length: 41 }, (_, i) => ({ row: 70 + i, set: { cost: 1 } }))), 'Send 1 to 40 lines.');
  eq(lines('x'), 'Send 1 to 40 lines.');
  eq(lines([{ row: 30, set: { cost: 1 } }]), 'A line has no row.', 'the summary is above the breakdown');
  eq(lines([{ row: 70.5, set: { cost: 1 } }]), 'A line has no row.');
  eq(lines([{ set: { cost: 1 } }]), 'A line has no row.');
  eq(lines([{ row: 70, set: { cost: 1 } }, { row: 70, set: { qty: 1 } }]), 'Row 70 is sent twice.');
  eq(lines([{ row: 70, set: { cost: 1 }, expect: { colour: 'x' } }]), 'Unknown field colour.');
  eq(lines([{ row: 70, set: { cost: 1 }, expect: { desc: 'anything', cost: 'is compared, not checked' } }]), 'ok');
  eq(err('rab_line_set', { project_id: 'nope', section: 'pre', lines: [{ row: 70, set: { cost: 1 } }] }), 'Pick a project.');
  const r = run('rab_line_set', { section: 'pre', force: 'yes', lines: [{ row: 70, set: { cost: 1 } }] });
  eq(r.ok && [r.args.force, (r.args.lines as { expect: unknown }[])[0].expect], [false, {}], 'force only when true; expect defaults to {}');
});

Deno.test('M6 rab_line_add: a description (gear: an item) and, for gear, a group', () => {
  eq(err('rab_line_add', { section: 'pre', set: { desc: 'Styling', cost: 250000 } }), 'ok');
  eq(err('rab_line_add', { section: 'pre', set: { cost: 250000 } }), 'A line needs a description.');
  eq(err('rab_line_add', { section: 'pre', set: { desc: '   ' } }), 'A line needs a description.');
  eq(err('rab_line_add', { section: 'equipment', group: 'lens', set: { qty: 2 } }), 'Pick or type the equipment.');
  eq(err('rab_line_add', { section: 'equipment', group: 'TRIPOD', set: { item: 'x' } }), 'Pick an equipment group.');
  eq(err('rab_line_add', { section: 'equipment', set: { item: 'x' } }), 'Pick an equipment group.');
  const r = run('rab_line_add', { section: 'equipment', group: ' lens ', set: { item: 'Sigma 35mm (Imajirent)', qty: 2 } });
  eq(r.ok && r.args, { project_id: PID, section: 'equipment', group: 'LENS', set: { item: 'Sigma 35mm (Imajirent)', qty: 2 } });
  const s = run('rab_line_add', { section: 'crew', group: 'LENS', set: { desc: 'DOP', person: 'Andi' } });
  eq(s.ok && s.args.group, null, 'a breakdown section has no group');
});

Deno.test('M6 rab_line_clear: a row and what the admin showed', () => {
  eq(err('rab_line_clear', { section: 'pre', row: 67, expect: { desc: 'Styling' } }), 'ok');
  eq(err('rab_line_clear', { section: 'pre', row: 67 }), 'expect is missing.');
  eq(err('rab_line_clear', { section: 'pre', row: 67, expect: {} }), 'expect is missing.');
  eq(err('rab_line_clear', { section: 'pre', expect: { desc: 'x' } }), 'A line has no row.');
  eq(err('rab_line_clear', { section: 'equipment', row: 90, expect: { item: 'x', manual_price: 0 } }), 'ok');
  eq(err('rab_line_clear', { section: 'equipment', row: 90, expect: { desc: 'x' } }), 'Unknown field desc.');
});

Deno.test('M6 rab_internal: the ten actual costs and Biaya lain, whole Rupiah', () => {
  eq(err('rab_internal', { set: { actual_1: 450000, actual_10: 0, other_estimate: 100000, other_actual: null } }), 'ok');
  eq(err('rab_internal', { set: { actual_11: 1 } }), "actual_11 can't be changed from the admin.");
  eq(err('rab_internal', { set: { actual_0: 1 } }), "actual_0 can't be changed from the admin.");
  eq(err('rab_internal', { set: { estimate_1: 1 } }), "estimate_1 can't be changed from the admin.", 'L is the formula');
  eq(err('rab_internal', { set: { actual_2: 1.5 } }), 'actual_2 must be a whole amount in Rupiah.');
  eq(err('rab_internal', { set: {} }), 'Nothing to change.');
});

Deno.test('M6: what the admin shows for the Sheet answers', () => {
  eq(friendly('line_moved'), 'This line changed or moved in the Sheet. Check it and try again.');
  eq(friendly('needs_sheet', 'PRE-PRODUCTION has no item rows. Add one in the Sheet.'), 'PRE-PRODUCTION has no item rows. Add one in the Sheet.');
  eq(friendly('not_enabled'), "This can't be done from the admin yet. Do it in the Sheet.");
});

Deno.test('M6: a line reply commits the RAB and clears Rekap and Keuangan for the next read', () => {
  const ctx = { seq: 130, actor_id: null, actor_email: 'admin@test', outbox_id: OP, forced: false, tab_gid: 3010 };
  const data = {
    layout: 'v2', meta: { client_code: 'ACME', doc_type: 'PENAWARAN' }, sections: [], equipment: null, crew_lines: [], unlocked: 0,
    summary: { categories: [], discount_pct: 0, ppn_pct: 0, dp_pct: 0.5 }, internal: { pph23_pct: 0, unlocked_gear: 0 }, placeholders: false,
  };
  const rab = { gid: 3010, name: '010 ACME - Lookbook', layout: 'v2' as const, digest: 'tab-3010-b', data };
  for (const op of ['rab_line_set', 'rab_line_add', 'rab_line_clear', 'rab_internal']) {
    // deno-lint-ignore no-explicit-any
    const p = buildWriteCommit({ seq: 130, rab, tab: { name: '010 ACME - Lookbook', gid: 3010 }, written: ['cost@66'] } as any, { ...ctx, op });
    eq([p.rab?.map((x) => [x.gid, x.client_code]), p.digests, p.null_digests], [[[3010, 'ACME']], { 'tab:3010': 'tab-3010-b' }, ['keuangan', 'rekap']], op);
  }
});

Deno.test('rab_meta: net profit takes 0% to 25% and refuses an empty rate', () => {
  const np = (v: unknown) => err('rab_meta', { set: { net_profit_pct: v } });
  eq([np(0), np(0.07), np(0.1), np(0.25)], ['ok', 'ok', 'ok', 'ok']);
  for (const v of [-0.01, 0.26, 1, '0.1', true]) eq(np(v), 'net_profit_pct must be between 0% and 25%.', String(v));
  for (const v of [null, '']) eq(np(v), "net_profit_pct can't be empty.", String(v));
  // the rate the admin saw goes along unchecked as expect (0 included), so a first write onto 0% isn't refused
  const r = run('rab_meta', { set: { net_profit_pct: 0.15 }, expect: { net_profit_pct: 0 } });
  eq(r.ok && r.args, { project_id: PID, set: { net_profit_pct: 0.15 }, expect: { net_profit_pct: 0 }, force: false });
});
