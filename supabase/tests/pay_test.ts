// pay-link and pay-page (the private invoice link) with stand-ins for Auth, the database and Gmail, plus the token,
// the limits key and both emails.
//   deno test --no-check --allow-read --allow-env supabase/tests/pay_test.ts
import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import type { UserAuth } from '../functions/_shared/auth.ts';
import type { Mail, MailConfig } from '../functions/_shared/mail.ts';
import { callerKey, invoiceMail, newToken, oneLine, paidMail, rupiah, type Summary, tanggal, TOKEN_RE, tokenHash } from '../functions/_shared/pay.ts';
import { DAYS, type Deps as LinkDeps, handle as linkHandle } from '../functions/pay-link/handler.ts';
import { type Deps as PageDeps, handle as pageHandle } from '../functions/pay-page/handler.ts';

const CFG: MailConfig = { host: 'smtp.test', port: 465, user: 'hello@creativeclubcult.com', pass: 'abcdefghijklmnop', from: 'hello@creativeclubcult.com', fromName: 'Creative Club Cult' };
const UID = 'c31dc323-9da9-4f2b-a2c2-9815fb9735a5';
const PID = '0000aaaa-5a5a-4000-8000-000000000103';
const LID = '1111bbbb-5a5a-4000-8000-000000000001';
const ORIGIN = 'https://creativeclubcult.com';
const SUMMARY: Summary = {
  invoice: { client: 'SAMPLE Lumbung', title: 'SAMPLE Launch Film', doc_no: '103/LMB/011126', total: 10_000_000, paid: 4_000_000, owed: 6_000_000, due_on: '2026-11-20' },
  bank: { bank: 'SAMPLE BANK', account_no: '0000 0000 00', account_name: 'SAMPLE CCC', note: 'Tulis nomor invoice di berita transfer.' },
  expires_at: '2027-01-05T03:00:00.000Z',
  said_paid_at: null,
};

// ---------- small pieces ----------
Deno.test('tokens: 43 characters of base64url, never the same twice, kept as their SHA-256', async () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const t = newToken();
    assertMatch(t, TOKEN_RE);
    seen.add(t);
  }
  assertEquals(seen.size, 500);
  assertEquals(await tokenHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

Deno.test('the limits key: an HMAC of the address, never the address', async () => {
  const r = (h: Record<string, string>) => new Request('https://x.test/', { headers: h });
  const a = await callerKey('server key', r({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }));
  assertMatch(a, /^[0-9a-f]{64}$/);
  assert(!a.includes('203'));
  assertEquals(a, await callerKey('server key', r({ 'x-forwarded-for': '203.0.113.7' })));
  assertEquals(await callerKey('server key', r({ 'cf-connecting-ip': '198.51.100.2', 'x-forwarded-for': '203.0.113.7' })),
    await callerKey('server key', r({ 'x-forwarded-for': '198.51.100.2' })));
  assert(a !== await callerKey('other key', r({ 'x-forwarded-for': '203.0.113.7' })));
});

Deno.test('Indonesian money and dates, and one clean line from the client', () => {
  assertEquals(rupiah(6_000_000), 'Rp 6.000.000');
  assertEquals(tanggal('2026-11-20'), '20 November 2026');
  assertEquals(tanggal('2027-01-04T18:30:00Z'), '5 Januari 2027'); // already the 5th in Jakarta
  assertEquals(tanggal(null), '');
  assertEquals(oneLine('  Transfer\n dari\tBCA \u0000 kemarin  ', 300), 'Transfer dari BCA kemarin');
  assertEquals(oneLine('x'.repeat(400), 300).length, 300);
});

Deno.test('the invoice email: Indonesian, the amounts, the bank, the link and its last day', () => {
  const m = invoiceMail('finance@lumbung.test', { pic: 'Sari', summary: SUMMARY, url: `${ORIGIN}/pay#tok` });
  assertEquals(m.to, 'finance@lumbung.test');
  assertEquals(m.subject, 'Tagihan 103/LMB/011126 dari Creative Club Cult');
  for (const s of ['Halo Kak Sari,', 'SAMPLE Launch Film (invoice 103/LMB/011126)', 'Total: Rp 10.000.000', 'Sudah dibayar: Rp 4.000.000',
    'Sisa tagihan: Rp 6.000.000', 'Jatuh tempo: 20 November 2026', 'SAMPLE BANK\n0000 0000 00\na.n. SAMPLE CCC',
    'Tulis nomor invoice di berita transfer.', `${ORIGIN}/pay#tok`, 'berlaku sampai 5 Januari 2027', 'Balas email ini saja']) {
    assert(m.text.includes(s), s);
  }
  // nothing paid yet: just what is owed, and no greeting by name without one
  const plain = invoiceMail('a@b.test', { pic: null, summary: { ...SUMMARY, invoice: { ...SUMMARY.invoice, paid: 0, owed: 10_000_000, due_on: null } }, url: 'u' });
  assert(plain.text.startsWith('Halo,\n'));
  assert(!plain.text.includes('Sudah dibayar') && !plain.text.includes('Total:') && !plain.text.includes('Jatuh tempo'));
  assert(!/[–—]/.test(m.text + plain.text));
});

Deno.test('the note to the team: who, which invoice, when in Jakarta, the note and the project', () => {
  const m = paidMail('hello@creativeclubcult.com', { summary: SUMMARY, at: '2026-11-06T07:05:00Z', note: 'Transfer dari BCA', link: `${ORIGIN}/admin#projects/${PID}` });
  assertEquals(m.subject, 'SAMPLE Lumbung says they paid invoice 103/LMB/011126');
  for (const s of ['Rp 6.000.000 was still owed', 'on 6 Nov 2026 at 14:05 Jakarta time', 'Their note: "Transfer dari BCA"', `/admin#projects/${PID}`]) {
    assert(m.text.includes(s), s);
  }
});

Deno.test('no figure in the Sheet is never written as Rp 0', () => {
  const unknown: Summary = { ...SUMMARY, invoice: { ...SUMMARY.invoice, owed: null } };
  const team = paidMail('hello@creativeclubcult.com', { summary: unknown, at: '2026-11-06T07:05:00Z', note: null, link: 'l' });
  assert(team.text.includes('The Sheet has no amount owed for it right now.'));
  const client = invoiceMail('a@b.test', { pic: null, summary: unknown, url: 'u' });
  assert(!client.text.includes('Sisa tagihan') && !client.text.includes('Sudah dibayar'));
  assert(!/Rp\s?0(?![.\d])/.test(team.text + client.text));
});

// ---------- pay-link ----------
const linkReq = (body: Record<string, unknown>, origin = ORIGIN) =>
  new Request('https://x.supabase.co/functions/v1/pay-link', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

interface LinkWorld { auth: UserAuth; mail: MailConfig | null; sent: Mail[]; calls: { fn: string; args: Record<string, unknown> }[]; answers: Record<string, unknown>; sendFails?: boolean }
const owner = (o: Partial<{ role: string; canEdit: boolean; money: boolean; owner: boolean }> = {}): UserAuth =>
  ({ ok: true, user: { id: UID, email: 'hello@creativeclubcult.com', role: 'owner', canEdit: true, money: true, owner: true, ...o } });
function linkWorld(o: Partial<LinkWorld> = {}): LinkWorld {
  return {
    auth: owner(), mail: CFG, sent: [], calls: [],
    answers: { pay_link_create: { ok: true, id: LID, pic: 'Sari', ...SUMMARY }, pay_link_revoke: { ok: true } }, ...o,
  };
}
function linkDeps(w: LinkWorld): LinkDeps {
  return {
    user: () => Promise.resolve(w.auth),
    rpc: <T>(fn: string, args: Record<string, unknown>) => {
      w.calls.push({ fn, args });
      return Promise.resolve((w.answers[fn] ?? null) as T);
    },
    mail: () => w.mail,
    send: (_c, m) => { if (w.sendFails) return Promise.reject(new Error('535 not accepted')); w.sent.push(m); return Promise.resolve(); },
    originOk: (o) => o === ORIGIN,
  };
}
const link = async (w: LinkWorld, body: Record<string, unknown>, origin?: string) => {
  const r = await linkHandle(linkReq(body, origin), body, linkDeps(w));
  return { status: r.status, body: await r.json() };
};

Deno.test('pay-link: signed out, off the team or without the right is turned away before the database', async () => {
  assertEquals((await link(linkWorld(), { action: 'nope' })).status, 400);
  const out = linkWorld({ auth: { ok: false, status: 401, error: 'Sign in to the admin first.', code: 'unauthenticated' } });
  assertEquals((await link(out, { action: 'create', project_id: PID, via: 'copy' })).status, 401);
  const code = linkWorld({ auth: { ok: false, status: 403, error: 'Enter the code from your email first.', code: 'needs_code' } });
  assertEquals((await link(code, { action: 'revoke', id: LID })).body.code, 'needs_code');
  for (const who of [owner({ role: 'viewer', canEdit: false, money: false, owner: false }), owner({ role: 'admin', money: false, owner: false }),
    owner({ role: 'viewer', canEdit: false, money: true, owner: false })]) {
    const w = linkWorld({ auth: who });
    assertEquals(await link(w, { action: 'create', project_id: PID, via: 'copy' }), { status: 403, body: { error: 'Only owners and admins with money access can send invoice links.', code: 'forbidden' } });
    assertEquals((await link(w, { action: 'revoke', id: LID })).status, 403);
    assertEquals(w.calls, []);
  }
});

Deno.test('pay-link: a copied link is <origin>/pay#token, and the database gets only its hash', async () => {
  const w = linkWorld({ auth: owner({ role: 'admin', owner: false }) });
  const r = await link(w, { action: 'create', project_id: PID.toUpperCase(), via: 'copy', origin: 'https://evil.test' });
  assertEquals(r.status, 200);
  const m = /^https:\/\/creativeclubcult\.com\/pay#([A-Za-z0-9_-]{43})$/.exec(r.body.url);
  assert(m, r.body.url);
  assertEquals(r.body.id, LID);
  assertEquals(r.body.sent, false);
  assertEquals(r.body.expires_at, SUMMARY.expires_at);
  const args = w.calls[0].args;
  assertEquals(w.calls[0].fn, 'pay_link_create');
  assertEquals(args.p_hash, await tokenHash(m[1]));
  assertEquals({ ...args, p_hash: 'x' }, { p_user: UID, p_project: PID, p_hash: 'x', p_via: 'copy', p_to: null, p_days: DAYS });
  assertEquals(DAYS, 60);
  assert(!JSON.stringify(args).includes(m[1]));
  assertEquals(w.sent, []);
});

Deno.test('pay-link: bad input, and an origin that is not listed exactly', async () => {
  const w = linkWorld();
  for (const body of [{ action: 'create', project_id: 'nope', via: 'copy' }, { action: 'create', project_id: PID, via: 'sms' },
    { action: 'create', project_id: PID, via: 'email', to: 'not an email' }, { action: 'create', project_id: PID, via: 'email' }]) {
    assertEquals((await link(w, body)).status, 400, JSON.stringify(body));
  }
  assertEquals(await link(w, { action: 'create', project_id: PID, via: 'whatsapp' }, 'https://creativeclubcult.com.evil.test'),
    { status: 403, body: { error: 'Make invoice links from the admin page.', code: 'origin' } });
  assertEquals(w.calls, []);
});

Deno.test('pay-link: email without Gmail set up says so before anything is made', async () => {
  const w = linkWorld({ mail: null });
  const r = await link(w, { action: 'create', project_id: PID, via: 'email', to: 'finance@lumbung.test' });
  assertEquals(r.status, 503);
  assertEquals(r.body.code, 'mail_not_configured');
  assertEquals(w.calls, []);
  assertEquals((await link(w, { action: 'create', project_id: PID, via: 'whatsapp' })).status, 200);
});

Deno.test('pay-link: the database refusals become the admin\'s words', async () => {
  const cases: [string, number][] = [['forbidden', 403], ['not_found', 404], ['nothing_owed', 409], ['no_amount', 409], ['no_bank', 409], ['limit', 429], ['limit_to', 429], ['odd', 500]];
  for (const [reason, status] of cases) {
    const w = linkWorld({ answers: { pay_link_create: { ok: false, reason } } });
    const r = await link(w, { action: 'create', project_id: PID, via: 'copy' });
    assertEquals(r.status, status, reason);
    assertEquals(r.body.code, reason === 'odd' ? 'error' : reason);
    assert(typeof r.body.error === 'string' && r.body.error.length > 10);
    assertEquals(r.body.url, undefined);
  }
});

Deno.test('pay-link: email sends the invoice in Indonesian, marks it sent, and keeps the link out of the reply', async () => {
  const w = linkWorld();
  const r = await link(w, { action: 'create', project_id: PID, via: 'email', to: ' Finance@Lumbung.test ' });
  assertEquals(r, { status: 200, body: { id: LID, expires_at: SUMMARY.expires_at, sent: true } });
  assertEquals(w.calls.map((c) => c.fn), ['pay_link_create', 'pay_link_sent']);
  assertEquals(w.calls[0].args.p_to, 'finance@lumbung.test');
  assertEquals(w.calls[0].args.p_via, 'email');
  assertEquals(w.sent.length, 1);
  assertEquals(w.sent[0].to, 'finance@lumbung.test');
  const tok = /\/pay#([A-Za-z0-9_-]{43})/.exec(w.sent[0].text)![1];
  assertEquals(w.calls[0].args.p_hash, await tokenHash(tok));
  assert(w.sent[0].text.startsWith('Halo Kak Sari,'));
});

Deno.test('pay-link: a failed email takes its link back; only an owner sees why', async () => {
  for (const [who, detail] of [[owner(), true], [owner({ role: 'admin', owner: false }), false]] as const) {
    const w = linkWorld({ auth: who, sendFails: true });
    const r = await link(w, { action: 'create', project_id: PID, via: 'email', to: 'finance@lumbung.test' });
    assertEquals(r.status, 502);
    assertEquals(r.body.code, 'mail_failed');
    assertEquals('detail' in r.body, detail);
    assertEquals(w.calls.map((c) => c.fn), ['pay_link_create', 'pay_link_drop']);
    assertEquals(w.calls[1].args, { p_id: LID, p_user: UID });
  }
});

Deno.test('pay-link: turning a link off', async () => {
  const w = linkWorld();
  assertEquals(await link(w, { action: 'revoke', id: LID.toUpperCase() }), { status: 200, body: { ok: true } });
  assertEquals(w.calls[0], { fn: 'pay_link_revoke', args: { p_id: LID, p_user: UID } });
  assertEquals((await link(linkWorld({ answers: { pay_link_revoke: { ok: false } } }), { action: 'revoke', id: LID })).body.code, 'not_found');
  assertEquals((await link(linkWorld({ answers: { pay_link_revoke: { ok: false, reason: 'forbidden' } } }), { action: 'revoke', id: LID })).status, 403);
  assertEquals((await link(linkWorld(), { action: 'revoke', id: 'x' })).status, 400);
});

// ---------- pay-page ----------
const WHO = 'a'.repeat(64);
const pageReq = (body: Record<string, unknown>, origin = ORIGIN) =>
  new Request('https://x.supabase.co/functions/v1/pay-page', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
interface PageWorld { calls: { fn: string; args: Record<string, unknown> }[]; answers: Record<string, unknown>; mail: MailConfig | null; sent: Mail[]; later: Promise<unknown>[] }
function pageWorld(o: Partial<PageWorld> = {}): PageWorld {
  return {
    calls: [], mail: CFG, sent: [], later: [],
    answers: {
      pay_page_view: { ok: true, ...SUMMARY },
      pay_page_paid: { ok: true, at: '2026-11-06T07:05:00Z', again: false, project_id: PID, ...SUMMARY },
    },
    ...o,
  };
}
function pageDeps(w: PageWorld): PageDeps {
  return {
    rpc: <T>(fn: string, args: Record<string, unknown>) => { w.calls.push({ fn, args }); return Promise.resolve(w.answers[fn] as T); },
    who: () => Promise.resolve(WHO),
    mail: () => w.mail,
    send: (_c, m) => { w.sent.push(m); return Promise.resolve(); },
    later: (p) => { w.later.push(p); },
    originOk: (o) => o === ORIGIN,
  };
}
const page = async (w: PageWorld, body: Record<string, unknown>, origin?: string) => {
  const r = await pageHandle(pageReq(body, origin), body, pageDeps(w));
  await Promise.all(w.later);
  return { status: r.status, body: await r.json() };
};
const TOK = newToken();

Deno.test('pay-page: a malformed token gets the same 404 without asking the database', async () => {
  const w = pageWorld();
  assertEquals((await page(w, { action: 'steal', token: TOK })).status, 400);
  for (const token of [undefined, '', 'short', TOK + 'x', TOK.slice(0, 42) + '!', 42]) {
    assertEquals(await page(w, { action: 'view', token }), { status: 404, body: { error: 'Link ini sudah tidak berlaku.', code: 'not_found' } });
  }
  assertEquals(w.calls, []);
});

Deno.test('pay-page: view hands over that one invoice, the bank and the dates, nothing else', async () => {
  const w = pageWorld({ answers: { pay_page_view: { ok: true, ...SUMMARY, project_id: PID, token_hash: 'f'.repeat(64) } } });
  const r = await page(w, { action: 'view', token: TOK });
  assertEquals(r.status, 200);
  assertEquals(Object.keys(r.body).sort(), ['bank', 'expires_at', 'invoice', 'said_paid_at']);
  assertEquals(r.body.invoice, SUMMARY.invoice);
  assertEquals(w.calls, [{ fn: 'pay_page_view', args: { p_hash: await tokenHash(TOK), p_who: WHO } }]);
  // no figure in the Sheet: the page gets null, not 0
  const unknown = { ...SUMMARY, invoice: { ...SUMMARY.invoice, owed: null } };
  const u = await page(pageWorld({ answers: { pay_page_view: { ok: true, ...unknown } } }), { action: 'view', token: TOK });
  assertEquals(u.body.invoice.owed, null);
});

Deno.test('pay-page: dead links and busy callers', async () => {
  assertEquals((await page(pageWorld({ answers: { pay_page_view: { ok: false, reason: 'not_found' } } }), { action: 'view', token: TOK })).status, 404);
  assertEquals((await page(pageWorld({ answers: { pay_page_view: { ok: false, reason: 'limit' } } }), { action: 'view', token: TOK })).status, 429);
  assertEquals((await page(pageWorld({ answers: { pay_page_paid: { ok: false, reason: 'limit' } } }), { action: 'paid', token: TOK })).status, 429);
  assertEquals((await page(pageWorld({ answers: { pay_page_paid: { ok: false, reason: 'not_found' } } }), { action: 'paid', token: TOK })).status, 404);
  assertEquals((await page(pageWorld({ answers: { pay_page_paid: { ok: false, reason: 'nothing_owed' } } }), { action: 'paid', token: TOK })).body.code, 'nothing_owed');
});

Deno.test('pay-page: "I\'ve paid" once, a clean note, and the team hears about it', async () => {
  const w = pageWorld();
  const r = await page(w, { action: 'paid', token: TOK, note: `  Transfer\ndari BCA ${'x'.repeat(400)}` });
  assertEquals(r, { status: 200, body: { ok: true, at: '2026-11-06T07:05:00Z' } });
  const note = w.calls[0].args.p_note as string;
  assertEquals(note.length, 300);
  assert(note.startsWith('Transfer dari BCA x'));
  assertEquals(w.sent.length, 1);
  assertEquals(w.sent[0].to, 'hello@creativeclubcult.com');
  assert(w.sent[0].text.includes(`${ORIGIN}/admin#projects/${PID}`));

  // pressed again: the same answer, no second email
  const again = pageWorld({ answers: { pay_page_paid: { ok: true, at: '2026-11-06T07:05:00Z', again: true } } });
  assertEquals((await page(again, { action: 'paid', token: TOK })).status, 200);
  assertEquals(again.sent, []);
  // no Gmail: still recorded, no email
  const quiet = pageWorld({ mail: null });
  assertEquals((await page(quiet, { action: 'paid', token: TOK, note: '' })).status, 200);
  assertEquals(quiet.calls[0].args.p_note, null);
  assertEquals(quiet.sent, []);
  // an origin that isn't ours never goes in the email
  const odd = pageWorld();
  await page(odd, { action: 'paid', token: TOK }, 'https://evil.test');
  assert(odd.sent[0].text.includes('https://creativeclubcult.com/admin#projects/'));
  assert(!odd.sent[0].text.includes('evil'));
});
