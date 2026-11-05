// JSON responses with CORS limited to ADMIN_ORIGINS (patterns like https://*.vercel.app, http://localhost:*).
import { env } from './env.ts';

function originAllowed(origin: string): boolean {
  return env.origins.some((pat) => {
    const re = new RegExp('^' + pat.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('[^/]*') + '$');
    return re.test(origin);
  });
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const h: Record<string, string> = { Vary: 'Origin' };
  if (origin && originAllowed(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(req) },
  });
}

/** OPTIONS → 204 with CORS; other methods than POST → 405. Returns null when the request may go on. */
export function gate(req: Request): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.', code: 'method' });
  return null;
}

export async function readJson(req: Request, maxBytes = 2_000_000): Promise<{ raw: string; body: Record<string, unknown> } | null> {
  const raw = await req.text();
  if (raw.length > maxBytes) return null;
  try {
    const body = JSON.parse(raw || '{}');
    return body && typeof body === 'object' && !Array.isArray(body) ? { raw, body } : null;
  } catch {
    return null;
  }
}
