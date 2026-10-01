import { supabase } from './supabase';
import { ApiError } from './errors';

// Calls a Postgres function through PostgREST. public_* functions report
// expected errors as {"error": code}; owner_* functions raise. Both become
// ApiError with the same codes.
export async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  let res;
  try {
    res = await supabase.rpc(fn, args);
  } catch {
    throw new ApiError('network');
  }
  const { data, error, status } = res;
  if (error) {
    if (status === 0 || /fetch|network/i.test(error.message)) throw new ApiError('network');
    if (error.code === '42501') throw new ApiError('forbidden', error.hint, status);
    throw new ApiError(error.message || 'unknown', error.hint, status);
  }
  if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
    const d = data as { error: string; hint?: string };
    throw new ApiError(d.error, d.hint);
  }
  return data as T;
}
