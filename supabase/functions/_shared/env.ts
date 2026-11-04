// Configuration from function secrets, or else from Vault through public.sheets_runtime_config() (server key only).
// Pairing (sheets-bridge, kind 'pair') writes the shared secret to Vault, so nobody types or copies it. Nothing here has
// a default value that could reach production by accident: a missing setting makes the function answer 503
// "not configured" after authentication.

function secretKeyFromEnv(): string {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys = JSON.parse(raw) as Record<string, string>;
      const k = keys['default'] ?? Object.values(keys)[0];
      if (k) return k;
    } catch { /* fall through to the legacy key */ }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
}

const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

// function secrets win over Vault
const fixed = {
  webappUrl: Deno.env.get('SHEETS_WEBAPP_URL') ?? '',
  secret: Deno.env.get('SHEETS_SECRET') ?? '',
  sheetId: Deno.env.get('SHEETS_SPREADSHEET_ID') ?? '',
  sheetEnv: Deno.env.get('SHEETS_ENV') ?? '',
  cronKey: Deno.env.get('SHEETS_CRON_KEY') ?? '',
  origins: list(Deno.env.get('ADMIN_ORIGINS') ?? ''),
};

export const env = {
  supabaseUrl: (Deno.env.get('SUPABASE_URL') ?? '').replace(/\/$/, ''),
  serverKey: secretKeyFromEnv(),
  webappUrl: fixed.webappUrl,
  secret: fixed.secret,
  sheetId: fixed.sheetId,
  sheetEnv: fixed.sheetEnv as '' | 'dev' | 'prod',
  cronKey: fixed.cronKey,
  origins: fixed.origins,
};

let loadedAt = 0;

/** Fills the settings that have no function secret from Vault. Kept for a minute once the shared secret is there;
 *  before pairing it is read on every request. On a failed read the previous values stay. */
export async function loadConfig(): Promise<void> {
  if (loadedAt && Date.now() - loadedAt < 60_000) return;
  if (!env.supabaseUrl || !env.serverKey) return;
  try {
    const h: Record<string, string> = { apikey: env.serverKey, 'Content-Type': 'application/json' };
    if (env.serverKey.startsWith('eyJ')) h.Authorization = `Bearer ${env.serverKey}`; // legacy service_role JWT
    const res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/sheets_runtime_config`, {
      method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return;
    const c = (await res.json()) as Record<string, string | null> | null;
    if (!c || typeof c !== 'object') return;
    env.webappUrl = fixed.webappUrl || c.sheets_webapp_url || '';
    env.secret = fixed.secret || c.sheets_secret || '';
    env.sheetId = fixed.sheetId || c.sheets_spreadsheet_id || '';
    env.sheetEnv = (fixed.sheetEnv || c.sheets_env || '') as '' | 'dev' | 'prod';
    env.cronKey = fixed.cronKey || c.sheets_cron_key || '';
    env.origins = fixed.origins.length ? fixed.origins : list(c.admin_origins ?? '');
    loadedAt = env.secret ? Date.now() : 0;
  } catch { /* keep what we have; missingConfig reports the gap */ }
}

/** After pairing: read Vault again on the next request. */
export function forgetConfig() {
  loadedAt = 0;
}

/** Names of the settings this function still needs (empty = ready). */
export function missingConfig(need: ('webapp' | 'secret' | 'sheet' | 'env' | 'cron')[]): string[] {
  const out: string[] = [];
  if (!env.supabaseUrl || !env.serverKey) out.push('SUPABASE_URL/SUPABASE_SECRET_KEYS');
  for (const n of need) {
    if (n === 'webapp' && !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(env.webappUrl)) out.push('SHEETS_WEBAPP_URL');
    if (n === 'secret' && env.secret.length < 32) out.push('SHEETS_SECRET');
    if (n === 'sheet' && !/^[\w-]{30,60}$/.test(env.sheetId)) out.push('SHEETS_SPREADSHEET_ID');
    if (n === 'env' && env.sheetEnv !== 'dev' && env.sheetEnv !== 'prod') out.push('SHEETS_ENV');
    if (n === 'cron' && env.cronKey.length < 32) out.push('SHEETS_CRON_KEY');
  }
  return out;
}

// the live Sheet may only ever be paired with SHEETS_ENV=prod (and the reverse). Since 2026-11-04 it is the copy in
// the Shared Drive "CCC" of hello@creativeclubcult.com; the one before stays in the personal Drive as an archive.
export const PROD_SHEET = '1a5bRCaYtcTrhDyJtpaeCAQeKV58-kvd3NOfuJWGkVtM';
export const RETIRED_SHEETS = ['1lGOYzhB6TpamLVsf79P3cpLNPHfzFt6W7SeSbdxYZfw'];

const PROD_REF = 'zneckeqsvwbavqxpolri';
const DEV_REF = 'jvhhcehzhgpcphtpynnx';

export function envMismatch(): string | null {
  if (!env.sheetId || !env.sheetEnv) return null;
  if (RETIRED_SHEETS.includes(env.sheetId)) return 'SHEETS_SPREADSHEET_ID is the old live Sheet, which is only an archive since 2026-11-04.';
  if ((env.sheetId === PROD_SHEET) !== (env.sheetEnv === 'prod')) {
    return 'SHEETS_ENV does not match SHEETS_SPREADSHEET_ID (the live Sheet is prod only, a copy is dev only).';
  }
  if (env.supabaseUrl.includes(PROD_REF) && env.sheetEnv !== 'prod') return 'The production database only syncs with the live Sheet.';
  if (env.supabaseUrl.includes(DEV_REF) && env.sheetEnv !== 'dev') return 'The dev database never syncs with the live Sheet.';
  return null;
}
