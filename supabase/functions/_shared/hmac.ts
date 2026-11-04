// HMAC-SHA256 signing shared by the three functions. The Apps Script side computes the same bytes with
// Utilities.computeHmacSha256Signature(message, secret, UTF_8), so the key is the secret's UTF-8 bytes.

const enc = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function key(secret: string): Promise<CryptoKey> {
  let k = keys.get(secret);
  if (!k) {
    k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    keys.set(secret, k);
  }
  return k;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function hmacHex(secret: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(message));
  return toHex(new Uint8Array(sig));
}

export async function sha256Hex(message: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(message))));
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Constant-time string comparison (length is not secret here: both sides are fixed-length hex or keys). */
export function safeEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** The request the Edge Functions send to the Apps Script web app. `args` is a JSON string, signed as sent. */
export interface SignedRequest {
  v: 1;
  ts: number;
  nonce: string;
  sheet: string;
  op: string;
  key: string;
  attempt: number;
  args: string;
  sig: string;
}

export function requestMessage(r: Omit<SignedRequest, 'sig'>): string {
  return [r.v, r.ts, r.nonce, r.sheet, r.op, r.key, r.attempt, r.args].join('\n');
}

export async function signRequest(
  secret: string,
  p: { sheet: string; op: string; key?: string; attempt?: number; args?: unknown; ts?: number; nonce?: string },
): Promise<SignedRequest> {
  const body = {
    v: 1 as const,
    ts: p.ts ?? Math.floor(Date.now() / 1000),
    nonce: p.nonce ?? crypto.randomUUID(),
    sheet: p.sheet,
    op: p.op,
    key: p.key ?? '',
    attempt: p.attempt ?? 1,
    args: JSON.stringify(p.args ?? {}),
  };
  return { ...body, sig: await hmacHex(secret, requestMessage(body)) };
}

/** The Apps Script tick signs `${t}.${body}` and sends X-CCC-Time / X-CCC-Sig (seconds since the epoch). */
export async function verifyScriptSignature(
  secret: string,
  time: string | null,
  sig: string | null,
  body: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<'ok' | 'unsigned' | 'stale' | 'bad_sig'> {
  if (!time || !sig) return 'unsigned';
  if (!/^\d{9,11}$/.test(time) || Math.abs(nowSec - Number(time)) > 300) return 'stale';
  const want = await hmacHex(secret, `${time}.${body}`);
  return safeEqual(want, sig.toLowerCase()) ? 'ok' : 'bad_sig';
}
