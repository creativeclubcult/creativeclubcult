// Email from hello@creativeclubcult.com through Gmail's SMTP server, signed in with an App Password (function secret
// GMAIL_APP_PASSWORD; GMAIL_USER when another address sends). Edge functions can't open ports 25 and 587, so this
// speaks SMTP over TLS on port 465. Plain text only: codes and links, nothing else.
import { hmacHex, randomHex } from './hmac.ts';

export interface Mail { to: string; subject: string; text: string }
export interface MailConfig { host: string; port: number; user: string; pass: string; from: string; fromName: string }

/** null until the App Password is set. Google shows it in four groups of four letters; spaces are dropped. */
export function mailConfig(): MailConfig | null {
  const pass = (Deno.env.get('GMAIL_APP_PASSWORD') ?? '').replace(/\s+/g, '');
  const user = (Deno.env.get('GMAIL_USER') ?? 'hello@creativeclubcult.com').trim().toLowerCase();
  if (!pass || !cleanEmail(user)) return null;
  return { host: 'smtp.gmail.com', port: 465, user, pass, from: user, fromName: 'Creative Club Cult' };
}

/** A lower case address, or null. Also what keeps line breaks and brackets out of the mail headers. */
export function cleanEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  if (e.length > 254) return null;
  const ok = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  return ok.test(e) ? e : null;
}

/** 6 digits, every value equally likely (4,294,000,000 is a multiple of a million). */
export function newCode(): string {
  const a = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(a);
    if (a[0] < 4_294_000_000) return String(a[0] % 1_000_000).padStart(6, '0');
  }
}

/** What the database keeps instead of the code: an HMAC tied to this sign in, keyed with the server key. */
export function codeHash(key: string, sessionId: string, code: string): Promise<string> {
  return hmacHex(key, `login-code:${sessionId.toLowerCase()}:${code}`);
}

// ---------- the messages ----------
const SIGN_IN = 'https://creativeclubcult.com/admin';

export function codeMail(to: string, code: string): Mail {
  return {
    to,
    subject: 'Your CCC Admin sign in code',
    text: [
      `Your code is ${code}`,
      '',
      'Enter it on the CCC Admin sign in page. It works once and expires in 10 minutes.',
      '',
      "We only send a code after the right password. If this wasn't you, reset your password now, because someone else knows it.",
      '',
      'Creative Club Cult',
    ].join('\n'),
  };
}

const ROLE_TEXT: Record<string, string> = {
  admin: 'as an admin: you can edit, and see leads and applicants',
  viewer: 'as a viewer: you can see projects, the schedule and clients',
};

export function inviteMail(to: string, o: { name: string | null; by: string | null; role: string; money: boolean; link: string; signIn?: string }): Mail {
  return {
    to,
    subject: "You're on the CCC Admin team",
    text: [
      o.name ? `Hi ${o.name},` : 'Hi,',
      '',
      `${o.by || 'The owner'} added you to the Creative Club Cult admin ${ROLE_TEXT[o.role] ?? 'as a team member'}.` +
        (o.money ? ' You also see amounts, Finance and the Kas.' : ''),
      '',
      'Set your password here:',
      o.link,
      '',
      `After that you sign in at ${o.signIn ?? SIGN_IN} with this email and your password, then a code we email you each time.`,
      'If the link has expired, open the sign in page and use Forgot password.',
      '',
      'Creative Club Cult',
    ].join('\n'),
  };
}

export function resetMail(to: string, link: string): Mail {
  return {
    to,
    subject: 'Set a new CCC Admin password',
    text: [
      'Someone asked to reset the password for this email on the CCC Admin.',
      '',
      'Set a new one here:',
      link,
      '',
      "If it wasn't you, ignore this email. Your password stays the same.",
      '',
      'Creative Club Cult',
    ].join('\n'),
  };
}

// ---------- SMTP ----------
export interface Conn { read(p: Uint8Array): Promise<number | null>; write(p: Uint8Array): Promise<number>; close(): void }
export type Connect = (host: string, port: number) => Promise<Conn>;

const tls: Connect = (hostname, port) => Deno.connectTls({ hostname, port });
const enc = new TextEncoder();
const dec = new TextDecoder();

export class MailError extends Error {}

function b64(s: string): string {
  const bytes = enc.encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

const wrap = (s: string, n: number) => s.match(new RegExp(`.{1,${n}}`, 'g'))?.join('\r\n') ?? '';
const word = (s: string) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;

/** The whole message: headers, then the text in base64 (so no line can start with a dot or run too long). */
export function message(cfg: MailConfig, m: Mail, now = new Date()): string {
  const to = cleanEmail(m.to);
  if (!to) throw new MailError('bad recipient');
  const headers = [
    `From: ${word(cfg.fromName)} <${cfg.from}>`,
    `To: <${to}>`,
    `Subject: ${word(m.subject.replace(/[\r\n]+/g, ' '))}`,
    `Date: ${now.toUTCString().replace(/GMT$/, '+0000')}`,
    `Message-ID: <${randomHex(16)}@${cfg.from.split('@')[1]}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  return headers.join('\r\n') + '\r\n\r\n' + wrap(b64(m.text.replace(/\r?\n/g, '\r\n')), 76);
}

/** Reads one complete reply (the last line is "250 ..." with a space after the code). */
function replies(conn: Conn) {
  let buf = '';
  const chunk = new Uint8Array(4096);
  return async function next(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = buf.split('\r\n');
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]) || /^\d{3}$/.test(lines[i])) {
          const text = lines.slice(0, i + 1).join('\n');
          buf = lines.slice(i + 1).join('\r\n');
          return { code: Number(lines[i].slice(0, 3)), text };
        }
      }
      const n = await conn.read(chunk);
      if (n === null) throw new MailError('the mail server closed the connection');
      buf += dec.decode(chunk.subarray(0, n), { stream: true });
      if (buf.length > 64_000) throw new MailError('the mail server sent too much');
    }
  };
}

async function writeAll(conn: Conn, s: string) {
  const bytes = enc.encode(s);
  let off = 0;
  while (off < bytes.length) off += await conn.write(bytes.subarray(off));
}

/** Sends one message. Errors carry the server's reply, never the password. */
export async function sendMail(cfg: MailConfig, m: Mail, connect: Connect = tls, timeoutMs = 15_000): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, no) => { timer = setTimeout(() => no(new MailError('the mail server took too long')), timeoutMs); });
  let conn: Conn | null = null;
  const talk = async () => {
    conn = await connect(cfg.host, cfg.port);
    const next = replies(conn);
    const step = async (line: string | null, want: number[], what: string) => {
      if (line !== null) await writeAll(conn!, line + '\r\n');
      const r = await next();
      if (!want.includes(r.code)) throw new MailError(`${what}: ${r.text.slice(0, 200)}`);
    };
    const body = message(cfg, m);
    await step(null, [220], 'greeting');
    await step(`EHLO ${cfg.from.split('@')[1]}`, [250], 'EHLO');
    await step(`AUTH PLAIN ${b64(`\u0000${cfg.user}\u0000${cfg.pass}`)}`, [235], 'sign in');
    await step(`MAIL FROM:<${cfg.from}>`, [250], 'sender');
    await step(`RCPT TO:<${cleanEmail(m.to)}>`, [250, 251], 'recipient');
    await step('DATA', [354], 'DATA');
    await step(body + '\r\n.', [250], 'message');
    await writeAll(conn, 'QUIT\r\n').catch(() => {});
  };
  try {
    await Promise.race([talk(), late]);
  } finally {
    clearTimeout(timer);
    try { (conn as Conn | null)?.close(); } catch { /* already closed */ }
  }
}
