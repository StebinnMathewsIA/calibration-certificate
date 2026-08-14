/**
 * Settle notification for the freshness gate (#150). The gate refreshes
 * the core caches, but a screen that is already mounted and focused (the
 * common case when the app returns to the foreground) has no focus event
 * to make it re-read them. Subscribing here is how such a screen repaints
 * from the just-refreshed cache the moment the gate settles.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns the unsubscribe. */
export function onFreshnessSettled(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyFreshnessSettled(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // One listener's error must not starve the rest.
    }
  }
}
