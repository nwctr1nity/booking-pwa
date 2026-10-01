import { env } from '@/env';
import { ApiError } from './errors';

// Calls a Postgres function through PostgREST with plain fetch, so the public
// pages do not ship supabase-js. The owner cabinet (lazy chunk) registers a
// token provider from its auth session; until then calls go as anon.
// public_* functions report expected errors as {"error": code}; owner_*
// functions raise. Both become ApiError with the same codes.
type TokenProvider = () => Promise<string | undefined>;
let accessToken: TokenProvider = async () => undefined;
export function setAccessTokenProvider(p: TokenProvider) {
  accessToken = p;
}

export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const token = (await accessToken()) ?? env.supabaseAnonKey;
  let res: Response;
  try {
    res = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: env.supabaseAnonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
  } catch {
    throw new ApiError('network');
  }
  const text = await res.text().catch(() => '');
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.ok ? 'unknown' : 'network', undefined, res.status);
  }
  if (!res.ok) {
    const e = (data ?? {}) as { code?: string; message?: string; hint?: string };
    if (e.code === '42501' || res.status === 401 || res.status === 403) throw new ApiError('forbidden', e.hint ?? undefined, res.status);
    if (res.status >= 500 && !e.message) throw new ApiError('network', undefined, res.status);
    throw new ApiError(e.message || 'unknown', e.hint ?? undefined, res.status);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    const d = data as { error: string; hint?: string };
    throw new ApiError(d.error, d.hint);
  }
  return data as T;
}
