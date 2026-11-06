// The private invoice link (pay-link and pay-page): the token, its hash, who is asking, and the two emails.
// A token is 32 random bytes in base64url (43 characters). It travels after the # of the link, so it never reaches
// a server log or a Referer header, and the database keeps only its SHA-256. Client text is Indonesian; the note to
// the team is English, like the admin.
import { hmacHex, sha256Hex } from './hmac.ts';
import type { Mail } from './mail.ts';

export const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const tokenHash = (token: string) => sha256Hex(token);

/** Who is asking, without keeping their address: an HMAC of it under the server key, for the limits. */
export function callerKey(key: string, req: Request): Promise<string> {
  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ||
    req.headers.get('x-real-ip') || 'unknown';
  return hmacHex(key, 'pay-page:' + ip.toLowerCase());
}

/** One line of text from the client: no control characters, single spaces. */
export const oneLine = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// ---------- what the database hands over (private.pay_summary) ----------
export interface Invoice {
  client: string | null;
  title: string | null;
  doc_no: string | null;
  total: number | null;
  paid: number | null;
  /** null when the Sheet has no figure for it: never shown as 0 */
  owed: number | null;
  due_on: string | null;
}
export interface Bank { bank: string; account_no: string; account_name: string; note: string | null }
export interface Summary { invoice: Invoice; bank: Bank | null; expires_at: string; said_paid_at: string | null }

// ---------- Indonesian money and dates ----------
const RP = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
export const rupiah = (n: number) => RP.format(n).replace(/ /g, ' ');
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const JKT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
const JKT_TIME = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
/** "20 November 2026" from 2026-11-20, or from a moment as the day it is in Jakarta */
export function tanggal(s: string | null): string {
  if (!s) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : JKT.format(new Date(s));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? `${+m[3]} ${BULAN[+m[2] - 1]} ${m[1]}` : '';
}
const day = (t: string) => { const [y, m, d] = JKT.format(new Date(t)).split('-'); return `${+d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+m - 1]} ${y}`; };

// ---------- the invoice email (to the client, Indonesian) ----------
export function invoiceMail(to: string, o: { pic: string | null; summary: Summary; url: string }): Mail {
  const i = o.summary.invoice, b = o.summary.bank;
  const what = (i.title || 'project Anda') + (i.doc_no ? ` (invoice ${i.doc_no})` : '');
  const part = i.owed != null && !!(i.paid && i.paid > 0 && i.total && i.total > i.owed);
  const text = [
    o.pic ? `Halo Kak ${o.pic},` : 'Halo,',
    '',
    `Berikut tagihan dari Creative Club Cult untuk ${what}.`,
    '',
    ...(part ? [`Total: ${rupiah(i.total!)}`, `Sudah dibayar: ${rupiah(i.paid!)}`] : []),
    ...(i.owed != null ? [`Sisa tagihan: ${rupiah(i.owed)}`] : []),
    ...(i.due_on ? [`Jatuh tempo: ${tanggal(i.due_on)}`] : []),
    '',
    ...(b ? ['Pembayaran lewat transfer ke:', b.bank, b.account_no, `a.n. ${b.account_name}`, ...(b.note ? ['', b.note] : []), ''] : []),
    'Rincian tagihan ada di halaman ini. Setelah transfer, tekan "Saya sudah transfer" di sana supaya tim kami langsung mengecek:',
    o.url,
    `Link ini berlaku sampai ${tanggal(o.summary.expires_at)}.`,
    '',
    'Ada pertanyaan? Balas email ini saja.',
    '',
    'Terima kasih,',
    'Creative Club Cult',
  ].join('\n');
  return { to, subject: `Tagihan ${i.doc_no ? i.doc_no + ' ' : ''}dari Creative Club Cult`, text };
}

// ---------- "the client says they paid" (to the team, English) ----------
export function paidMail(to: string, o: { summary: Summary; at: string; note: string | null; link: string }): Mail {
  const i = o.summary.invoice, who = i.client || 'A client';
  const what = i.doc_no ? `invoice ${i.doc_no}` : 'an invoice';
  return {
    to,
    subject: `${who} says they paid ${what}`,
    text: [
      `${who} says they paid ${what}${i.title ? ` for ${i.title}` : ''}. ` +
        (i.owed != null ? `${rupiah(i.owed)} was still owed.` : 'The Sheet has no amount owed for it right now.'),
      `They pressed "I've paid" on ${day(o.at)} at ${JKT_TIME.format(new Date(o.at))} Jakarta time.`,
      ...(o.note ? ['', `Their note: "${o.note}"`] : []),
      '',
      'Check the bank. Once the money is there, save the payment on the project:',
      o.link,
      '',
      'CCC Admin',
    ].join('\n'),
  };
}
