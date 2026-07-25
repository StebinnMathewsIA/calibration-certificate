/**
 * Bare HTTP transport for the backend API. Split from client.ts so the
 * offline outbox (src/sync/outbox.ts) can replay writes without importing
 * the wrapped client functions (which enqueue INTO the outbox — #66).
 */
import { config } from '../config';

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail: unknown,
  ) {
    super(`API error ${status}`);
  }
}

/** True when the failure means "no network", not "the server said no". */
export function isNetworkError(err: unknown): boolean {
  return !(err instanceof ApiError);
}

export async function request(
  path: string,
  token: string | null,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, (body as { detail?: unknown })?.detail ?? body);
  return body;
}
