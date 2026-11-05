// team-access and the mail helper: codes, hashes, addresses, the SMTP talk (against a fake server on 127.0.0.1)
// and every action of the handler with stand-ins for Auth, the database and Gmail.
//   deno test --no-check --allow-read --allow-env --allow-net=127.0.0.1 supabase/tests/access_test.ts
import { assert, assertEquals, assertMatch, assertRejects } from 'jsr:@std/assert@1';
import { jwtClaims, type AccessState, type SignedInAuth } from '../functions/_shared/auth.ts';
import { cleanEmail, codeHash, type Connect, type Mail, type MailConfig, message, newCode, sendMail } from '../functions/_shared/mail.ts';
import { type Deps, handle, type Link } from '../functions/team-access/handler.ts';

const CFG: MailConfig = { host: 'smtp.test', port: 465, user: 'hello@creativeclubcult.com', pass: 'abcdefghijklmnop', from: 'hello@creativeclubcult.com', fromName: 'Creative Club Cult' };
const SID = '7d0c2f2e-1111-4a4a-8b8b-000000000001';
const UID = 'c31dc323-9da9-4f2b-a2c2-9815fb9735a5';
const fromB64 = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

// ---------- small pieces ----------
Deno.test('codes are 6 digits and spread over all of them', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    const c = newCode();
    assertMatch(c, /^\d{6}$/);
    seen.add(c[0]);
  }
  assertEquals(seen.size, 10);
});

Deno.test('the stored hash is tied to the sign in and the code', async () => {
  const a = await codeHash('k', SID, '123456');
  assertMatch(a, /^[0-9a-f]{64}$/);
  assertEquals(a, await codeHash('k', SID.toUpperCase(), '123456'));
  assert(a !== await codeHash('k', SID, '123457'));
  assert(a !== await codeHash('k', SID.replace(/1$/, '2'), '123456'));
  assert(a !== await codeHash('other key', SID, '123456'));
});

Deno.test('addresses: lower case, and nothing that could break a mail header', () => {
  assertEquals(cleanEmail('  Rani.Finance@Gmail.com '), 'rani.finance@gmail.com');
  for (const bad of ['a@b', 'no at sign', 'a@b.com\r\nBcc: x@y.com', '<a@b.com>', 'a b@c.com', 'a@b.com,c@d.com', '', null, 42, `${'x'.repeat(250)}@b.com`]) {
    assertEquals(cleanEmail(bad), null, String(bad));
  }
});

Deno.test('JWT claims are read from base64url without padding', () => {
  const part = btoa(JSON.stringify({ sub: UID, session_id: SID, n: 'ä' }).replace(/[\u0080-￿]/g, (c) => unescape(encodeURIComponent(c))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const c = jwtClaims(`x.${part}.y`);
  assertEquals(c.sub, UID);
  assertEquals(c.session_id, SID);
  assertEquals(c.n, 'ä');
  assertEquals(jwtClaims('nonsense'), {});
});

Deno.test('the message: headers, then the text in base64 lines of 76', () => {
  const m = message(CFG, { to: 'Rani@Gmail.com', subject: 'Your CCC Admin sign in code', text: 'Line one\n.starts with a dot\n' + 'x'.repeat(200) },
    new Date(Date.UTC(2026, 10, 5, 3, 4, 5)));
  const [head, body] = m.split('\r\n\r\n');
  assert(head.includes('From: Creative Club Cult <hello@creativeclubcult.com>'));
  assert(head.includes('To: <rani@gmail.com>'));
  assert(head.includes('Date: Thu, 05 Nov 2026 03:04:05 +0000'));
  assert(head.includes('Content-Transfer-Encoding: base64'));
  for (const line of body.split('\r\n')) {
    assert(line.length <= 76);
    assert(!line.startsWith('.'));
  }
  assertEquals(fromB64(body.replace(/\r\n/g, '')), 'Line one\r\n.starts with a dot\r\n' + 'x'.repeat(200));
  assertRejects(async () => message(CFG, { to: 'bad\r\n@x.com', subject: 's', text: 't' }));
});

// ---------- SMTP against a fake server ----------
type Script = (line: string, say: (s: string) => Promise<void>) => Promise<boolean | void>;
async function fakeServer(script: Script, greet = true) {
  const l = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = (l.addr as Deno.NetAddr).port;
  const seen: string[] = [];
  const done = (async () => {
    const c = await l.accept();
    const enc = new TextEncoder(), dec = new TextDecoder();
    const say = async (s: string) => { await c.write(enc.encode(s + '\r\n')); };
    if (greet) await say('220 smtp.test ESMTP ready');
    let buf = '', inData = false;
    const chunk = new Uint8Array(65536);
    try {
      for (;;) {
        const n = await c.read(chunk);
        if (n === null) break;
        buf += dec.decode(chunk.subarray(0, n));
        if (inData) {
          const end = buf.indexOf('\r\n.\r\n');
          if (end < 0) continue;
          seen.push('DATA:' + buf.slice(0, end));
          buf = buf.slice(end + 5);
          inData = false;
          await say('250 2.0.0 OK queued');
        }
        let i;
        while (!inData && (i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          seen.push(line);
          if (line === 'DATA') { await say('354 Go ahead'); inData = true; continue; }
          if (await script(line, say) === false) { c.close(); return; }
        }
      }
    } catch { /* the client hung up */ }
    try { c.close(); } catch { /* closed */ }
  })();
  const connect: Connect = () => Deno.connect({ hostname: '127.0.0.1', port });
  return { connect, seen, done: () => done.finally(() => l.close()) };
}

const happy: Script = async (line, say) => {
  if (line.startsWith('EHLO')) await say('250-smtp.test hi\r\n250-AUTH LOGIN PLAIN\r\n250 SMTPUTF8');
  else if (line.startsWith('AUTH PLAIN')) await say('235 2.7.0 Accepted');
  else if (line.startsWith('MAIL FROM')) await say('250 2.1.0 OK');
  else if (line.startsWith('RCPT TO')) await say('250 2.1.5 OK');
  else if (line === 'QUIT') { await say('221 bye'); return false; }
};

Deno.test('SMTP: signs in, sends one message and quits', async () => {
  const s = await fakeServer(happy);
  await sendMail(CFG, { to: 'rani@gmail.com', subject: 'Hi', text: 'Your code is 123456' }, s.connect, 5000);
  await s.done();
  assertEquals(s.seen[0], 'EHLO creativeclubcult.com');
  assertEquals(fromB64(s.seen[1].slice('AUTH PLAIN '.length)), '\u0000hello@creativeclubcult.com\u0000abcdefghijklmnop');
  assertEquals(s.seen[2], 'MAIL FROM:<hello@creativeclubcult.com>');
  assertEquals(s.seen[3], 'RCPT TO:<rani@gmail.com>');
  assertEquals(s.seen[4], 'DATA');
  assert(s.seen[5].startsWith('DATA:From: Creative Club Cult'));
  assert(fromB64(s.seen[5].split('\r\n\r\n')[1].replace(/\r\n/g, '')).includes('123456'));
  assertEquals(s.seen[6], 'QUIT');
});

Deno.test('SMTP: a refused App Password fails with the reply, never the password', async () => {
  const s = await fakeServer(async (line, say) => {
    if (line.startsWith('EHLO')) await say('250 smtp.test');
    else if (line.startsWith('AUTH')) await say('535-5.7.8 Username and Password not accepted.\r\n535 5.7.8 Learn more');
  });
  const e = await assertRejects(() => sendMail(CFG, { to: 'rani@gmail.com', subject: 'Hi', text: 't' }, s.connect, 5000));
  await s.done();
  assertMatch(String(e), /sign in: 535/);
  assert(!String(e).includes(CFG.pass));
  assert(!String(e).includes(btoa(`\u0000${CFG.user}\u0000${CFG.pass}`)));
});

Deno.test('SMTP: a silent server times out', async () => {
  const s = await fakeServer(async () => {}, false);
  const t0 = Date.now();
  await assertRejects(() => sendMail(CFG, { to: 'rani@gmail.com', subject: 'Hi', text: 't' }, s.connect, 300), Error, 'took too long');
  assert(Date.now() - t0 < 2000);
  await s.done();
});

// ---------- the handler ----------
const ORIGIN = 'https://creativeclubcult.com';
const req = (body: Record<string, unknown>, origin = ORIGIN) =>
  new Request('https://x.supabase.co/functions/v1/team-access', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

interface World {
  who: SignedInAuth; st: AccessState; mail: MailConfig | null; sent: Mail[]; calls: { fn: string; args: Record<string, unknown> }[];
  rpcAnswers: Record<string, unknown>; links: Link[]; members: Record<string, unknown>[]; sendFails?: boolean; later: Promise<unknown>[];
  memberExists?: boolean;
}
function world(o: Partial<World> = {}): World {
  return {
    who: { ok: true, who: { id: UID, email: 'hello@creativeclubcult.com', sessionId: SID } },
    st: { member: true, role: 'owner', money: true, email: 'hello@creativeclubcult.com', name: 'Mitchel', required: false, verified: false, code_live: false },
    mail: CFG, sent: [], calls: [], rpcAnswers: {}, links: [], members: [], later: [], ...o,
  };
}
function deps(w: World): Deps {
  return {
    signedIn: () => Promise.resolve(w.who),
    state: () => Promise.resolve(w.st),
    rpc: <T>(fn: string, args: Record<string, unknown>) => {
      w.calls.push({ fn, args });
      const a = w.rpcAnswers[fn];
      return Promise.resolve((typeof a === 'function' ? a(args) : a) as T);
    },
    link: (type, email) => {
      w.calls.push({ fn: 'link:' + type, args: { email } });
      return Promise.resolve(w.links.shift() ?? { status: 500, id: null, token: null, type: null, error: 'none left' });
    },
    addMember: (row) => { w.members.push(row); return Promise.resolve(w.memberExists ? 'exists' : 'added'); },
    mail: () => w.mail,
    send: (_c, m) => { if (w.sendFails) return Promise.reject(new Error('535 not accepted')); w.sent.push(m); return Promise.resolve(); },
    key: () => 'server key',
    later: (p) => { w.later.push(p); },
    originOk: (o) => o === ORIGIN,
  };
}
const run = async (w: World, body: Record<string, unknown>, origin?: string) => {
  const r = await handle(req(body, origin), body, deps(w));
  await Promise.all(w.later);
  return { status: r.status, body: await r.json() };
};

Deno.test('status: outsiders learn nothing but "not on the team"', async () => {
  const w = world({ st: { ...world().st, member: false, role: null } });
  assertEquals(await run(w, { action: 'status' }), { status: 200, body: { member: false } });
});

Deno.test('status: a member hears where this sign in stands', async () => {
  const r = await run(world(), { action: 'status' });
  assertEquals(r.body, { member: true, role: 'owner', verified: false, required: false, mail: true, code_live: false });
  assertEquals((await run(world({ mail: null }), { action: 'status' })).body.mail, false);
});

Deno.test('signed out: 401 for every action but reset', async () => {
  const w = world({ who: { ok: false, status: 401, error: 'Sign in to the admin first.', code: 'unauthenticated' } });
  for (const action of ['status', 'send', 'verify', 'invite']) assertEquals((await run(w, { action })).status, 401);
  assertEquals((await run(w, { action: 'nope' })).status, 400);
});

Deno.test('send: the emailed code is the one whose hash the database keeps', async () => {
  const w = world({ rpcAnswers: { access_code_issue: { ok: true } } });
  const r = await run(w, { action: 'send' });
  assertEquals(r, { status: 200, body: { sent: true } });
  assertEquals(w.sent.length, 1);
  assertEquals(w.sent[0].to, 'hello@creativeclubcult.com');
  const code = /Your code is (\d{6})/.exec(w.sent[0].text)![1];
  assertEquals(w.calls[0].args.p_hash, await codeHash('server key', SID, code));
  assertEquals(w.calls[0].args.p_session, SID);
});

Deno.test('send: limits, a pass already made, no email set up, a failed email', async () => {
  assertEquals((await run(world({ rpcAnswers: { access_code_issue: { ok: false, reason: 'wait', wait: 42 } } }), { action: 'send' })).body, { sent: false, wait: 42 });
  assertEquals((await run(world({ rpcAnswers: { access_code_issue: { ok: false, reason: 'limit' } } }), { action: 'send' })).status, 429);
  assertEquals((await run(world({ rpcAnswers: { access_code_issue: { ok: false, reason: 'no_session' } } }), { action: 'send' })).status, 401);
  assertEquals((await run(world({ st: { ...world().st, verified: true } }), { action: 'send' })).body, { sent: false, verified: true });
  assertEquals((await run(world({ mail: null }), { action: 'send' })).status, 503);
  const w = world({ sendFails: true, rpcAnswers: { access_code_issue: { ok: true } } });
  const r = await run(w, { action: 'send' });
  assertEquals(r.status, 502);
  assertEquals(r.body.code, 'mail_failed');
  assertEquals(w.calls.map((c) => c.fn), ['access_code_issue', 'access_code_drop']);
  const crew = world({ sendFails: true, st: { ...world().st, role: 'viewer' }, rpcAnswers: { access_code_issue: { ok: true } } });
  assertEquals((await run(crew, { action: 'send' })).body.detail, undefined);
});

Deno.test('verify: the right code passes; wrong ones count down', async () => {
  const ok = world({ rpcAnswers: { access_code_check: { ok: true, turned_on: true } } });
  assertEquals(await run(ok, { action: 'verify', code: ' 123 456 ' }), { status: 200, body: { ok: true, turned_on: true } });
  assertEquals(ok.calls[0].args.p_hash, await codeHash('server key', SID, '123456'));
  const wrong = await run(world({ rpcAnswers: { access_code_check: { ok: false, reason: 'wrong', left: 1 } } }), { action: 'verify', code: '000000' });
  assertEquals(wrong.status, 422);
  assertEquals(wrong.body.error, "That code isn't right. 1 try left.");
  assertEquals((await run(world(), { action: 'verify', code: '12345' })).status, 400);
  assertEquals((await run(world(), { action: 'verify', code: 'abcdef' })).status, 400);
  assertEquals((await run(world({ st: { ...world().st, member: false } }), { action: 'verify', code: '123456' })).status, 403);
});

const invited = (o: Partial<World> = {}) => world({
  st: { ...world().st, required: true, verified: true },
  rpcAnswers: { access_member_email: null, access_mail_allow: true },
  links: [{ status: 200, id: 'new-user-id', token: 'tok_en-1', type: 'invite', error: null }],
  ...o,
});

Deno.test('invite: an owner adds someone and they get a link to set a password', async () => {
  const w = invited();
  const r = await run(w, { action: 'invite', email: ' Rani@Gmail.com ', name: ' Rani\n  Putri ', role: 'admin', money: true });
  assertEquals(r, { status: 200, body: { ok: true, mailed: true } });
  assertEquals(w.members, [{ user_id: 'new-user-id', email: 'rani@gmail.com', full_name: 'Rani Putri', role: 'admin', can_see_money: true }]);
  assertEquals(w.sent[0].to, 'rani@gmail.com');
  assert(w.sent[0].text.includes('https://creativeclubcult.com/admin/#set=tok_en-1&t=invite'));
  assert(w.sent[0].text.includes('Mitchel added you'));
  assert(w.sent[0].text.includes('You also see amounts'));
});

Deno.test('invite: an account from before gets a reset link instead', async () => {
  const w = invited({ links: [{ status: 422, id: null, token: null, type: null, error: 'email_exists' }, { status: 200, id: 'old-id', token: 'tok2', type: 'recovery', error: null }] });
  const r = await run(w, { action: 'invite', email: 'old@gmail.com', role: 'viewer' });
  assertEquals(r.body, { ok: true, mailed: true });
  assertEquals(w.calls.filter((c) => c.fn.startsWith('link:')).map((c) => c.fn), ['link:invite', 'link:recovery']);
  assertEquals(w.members[0].can_see_money, false);
  assert(w.sent[0].text.includes('#set=tok2&t=recovery'));
});

Deno.test('invite: who may, and what is refused', async () => {
  const crew = invited({ st: { ...world().st, role: 'admin', verified: true } });
  assertEquals((await run(crew, { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 403);
  const noCode = invited({ st: { ...world().st, required: true, verified: false } });
  assertEquals((await run(noCode, { action: 'invite', email: 'a@b.com', role: 'viewer' })).body.code, 'needs_code');
  assertEquals((await run(invited(), { action: 'invite', email: 'a@b.com', role: 'viewer' }, 'https://evil.example')).status, 403);
  assertEquals((await run(invited({ mail: null }), { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 503);
  assertEquals((await run(invited(), { action: 'invite', email: 'not an email', role: 'viewer' })).status, 400);
  assertEquals((await run(invited(), { action: 'invite', email: 'a@b.com', role: 'owner' })).status, 400);
  assertEquals((await run(invited({ rpcAnswers: { access_member_email: 'a@b.com', access_mail_allow: true } }), { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 409);
  assertEquals((await run(invited({ rpcAnswers: { access_member_email: null, access_mail_allow: false } }), { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 429);
  assertEquals((await run(invited({ memberExists: true }), { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 409);
  assertEquals((await run(invited({ links: [] }), { action: 'invite', email: 'a@b.com', role: 'viewer' })).status, 502);
  const quiet = invited({ sendFails: true });
  assertEquals((await run(quiet, { action: 'invite', email: 'a@b.com', role: 'viewer' })).body, { ok: true, mailed: false });
  assertEquals(quiet.members.length, 1);
});

Deno.test('reset: the same answer for anyone; only team emails get a link', async () => {
  const outsider = world({ who: { ok: false, status: 401, error: '', code: '' }, rpcAnswers: { access_mail_allow: true, access_member_email: null } });
  assertEquals(await run(outsider, { action: 'reset', email: 'who@ever.com' }), { status: 200, body: { ok: true } });
  assertEquals(outsider.sent.length, 0);
  const member = world({ rpcAnswers: { access_mail_allow: true, access_member_email: 'hello@creativeclubcult.com' }, links: [{ status: 200, id: UID, token: 'rt', type: 'recovery', error: null }] });
  assertEquals(await run(member, { action: 'reset', email: 'HELLO@creativeclubcult.com' }), { status: 200, body: { ok: true } });
  assertEquals(member.sent[0].to, 'hello@creativeclubcult.com');
  assert(member.sent[0].text.includes('https://creativeclubcult.com/admin/#set=rt&t=recovery'));
  const capped = world({ rpcAnswers: { access_mail_allow: false, access_member_email: 'hello@creativeclubcult.com' }, links: [{ status: 200, id: UID, token: 'rt', type: 'recovery', error: null }] });
  assertEquals((await run(capped, { action: 'reset', email: 'hello@creativeclubcult.com' })).body, { ok: true });
  assertEquals(capped.sent.length, 0);
  assertEquals((await run(world(), { action: 'reset', email: 'x@y.com' }, 'https://evil.example')).status, 403);
  assertEquals((await run(world({ mail: null }), { action: 'reset', email: 'x@y.com' })).status, 503);
  assertEquals((await run(world(), { action: 'reset', email: 'nope' })).status, 400);
});
