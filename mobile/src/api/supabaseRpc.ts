/**
 * Direct Supabase reads (Architecture v2 phase 1, #65): one round trip to
 * PostgREST RPC instead of the Render-proxied read path. The functions live
 * in backend/migrations/010_app_rpc.sql and return the exact same shapes the
 * v1 endpoints did, so callers are transport-agnostic.
 */
import { config } from '../config';
import { ApiError } from './client';

export async function rpc<T>(
  name: string,
  token: string | null,
  args: Record<string, unknown> = {},
): Promise<T> {
  const res = await fetch(`${config.supabase.url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: config.supabase.anonKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(args),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // PostgREST surfaces our RAISE EXCEPTION text in `message`.
    const detail =
      (body as { message?: string } | null)?.message ?? body ?? `RPC ${name} failed`;
    const status =
      typeof detail === 'string' && detail.includes('not assigned') ? 403 : res.status;
    throw new ApiError(status, detail);
  }
  return body as T;
}
