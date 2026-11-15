// What a finished crew_rename / crew_delete does to public.crew (crewInDb in _shared/write.ts), against an
// in-memory stand-in for the REST API. Run: deno test --allow-read --allow-env supabase/tests/
import { crewInDb, type OutboxRow } from '../functions/_shared/write.ts';

type Crew = { id: string; name: string; sheet_state: string; network_profile_id: string | null; created_at: string; sheet_seen_at: string | null };

function eq(actual: unknown, expected: unknown, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  expected ${e}\n  actual   ${a}`);
}

function fakeDb(crew: Crew[], opCreated: string) {
  const kas = [{ id: 'k1', crew_id: 'dup' }, { id: 'k2', crew_id: 'old' }];
  const log: Record<string, unknown>[] = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input), 'http://db.test');
    const table = u.pathname.split('/').pop()!;
    const id = (u.searchParams.get('id') ?? u.searchParams.get('crew_id') ?? '').replace(/^eq\./, '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    let out: unknown = [];
    if (method === 'GET' && table === 'crew') out = Number(u.searchParams.get('offset') ?? 0) ? [] : crew.map((c) => ({ ...c }));
    else if (method === 'GET' && table === 'sync_outbox') out = [{ created_at: opCreated }];
    else if (method === 'PATCH' && table === 'crew') out = crew.filter((c) => c.id === id).map((c) => Object.assign(c, body));
    else if (method === 'PATCH' && table === 'kas_entries') out = kas.filter((k) => k.crew_id === id).map((k) => Object.assign(k, body));
    else if (method === 'DELETE' && table === 'crew') crew.splice(crew.findIndex((c) => c.id === id), 1);
    else if (method === 'POST' && table === 'activity_log') { log.push(body); out = [body]; }
    else throw new Error(`unexpected ${method} ${table}`);
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;
  return { kas, log, restore: () => { globalThis.fetch = orig; } };
}

const row = (op: string, args: Record<string, unknown>): OutboxRow => ({
  id: 'op1', op, target: 'crew:x', args, status: 'sending', attempts: 1, created_by: 'u1', actor_email: 'a@b.test',
  entity_id: null, forced: false, via: 'push',
});
const person = (id: string, name: string, state = 'present', created_at = '2026-11-15T10:00:00Z'): Crew =>
  ({ id, name, sheet_state: state, network_profile_id: null, created_at, sheet_seen_at: '2026-11-15T10:00:00Z' });

Deno.test('rename keeps the id, also when the Sheet replies noop: [] (an empty list)', async () => {
  const crew = [person('old', 'Budi')];
  const db = fakeDb(crew, '2026-11-15T11:00:00Z');
  try {
    await crewInDb(row('crew_rename', { name: 'Budi', to: 'Budi S' }), { renamed: { from: 'Budi', to: 'Budi S', kas: 2 }, written: ['name'], noop: [] });
    eq(crew.map((c) => [c.id, c.name, c.sheet_state]), [['old', 'Budi S', 'present']]);
    eq(db.log.length, 1);
  } finally { db.restore(); }
});

Deno.test('rename after a pull read the Sheet mid-write: the new row is folded back into the old id', async () => {
  const crew = [person('old', 'Budi', 'missing'), person('dup', 'Budi S', 'present', '2026-11-15T11:00:05Z')];
  const db = fakeDb(crew, '2026-11-15T11:00:00Z');
  try {
    await crewInDb(row('crew_rename', { name: 'Budi', to: 'Budi S' }), { renamed: { from: 'Budi', to: 'Budi S', kas: 2 }, noop: [] });
    eq(crew.map((c) => [c.id, c.name, c.sheet_state]), [['old', 'Budi S', 'present']]);
    eq(db.kas.map((k) => k.crew_id), ['old', 'old'], 'Kas links move to the kept id');
  } finally { db.restore(); }
});

Deno.test('rename leaves an older or linked person with the new name alone', async () => {
  for (const dup of [person('dup', 'Budi S', 'present', '2026-11-01T00:00:00Z'), { ...person('dup', 'Budi S', 'present', '2026-11-15T11:00:05Z'), network_profile_id: 'np1' }]) {
    const crew = [person('old', 'Budi', 'missing'), dup];
    const db = fakeDb(crew, '2026-11-15T11:00:00Z');
    try {
      await crewInDb(row('crew_rename', { name: 'Budi', to: 'Budi S' }), { renamed: { from: 'Budi', to: 'Budi S', kas: 2 }, noop: [] });
      eq(crew.map((c) => [c.id, c.name, c.sheet_state]), [['old', 'Budi', 'missing'], ['dup', 'Budi S', 'present']]);
      eq(db.log.length, 0);
    } finally { db.restore(); }
  }
});

Deno.test('a replayed rename (old name already gone) changes nothing', async () => {
  const crew = [person('old', 'Budi S')];
  const db = fakeDb(crew, '2026-11-15T11:00:00Z');
  try {
    await crewInDb(row('crew_rename', { name: 'Budi', to: 'Budi S' }), { renamed: { from: 'Budi', to: 'Budi S', kas: 0 }, noop: ['name'] });
    eq(crew.map((c) => [c.id, c.name]), [['old', 'Budi S']]);
    eq(db.log.length, 0);
  } finally { db.restore(); }
});

Deno.test('remove marks the person missing; a person a pull already marked missing is only logged', async () => {
  for (const state of ['present', 'missing']) {
    const crew = [person('old', 'Budi', state)];
    const db = fakeDb(crew, '2026-11-15T11:00:00Z');
    try {
      await crewInDb(row('crew_delete', { name: 'budi ' }), { removed_crew: { name: 'Budi' } });
      eq(crew[0].sheet_state, 'missing');
      eq(db.log.length, 1);
    } finally { db.restore(); }
  }
});
