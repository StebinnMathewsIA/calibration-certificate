/**
 * Crash journal (#148): the last fatal JS error, kept on the device.
 *
 * Exists because a dead screen reported from a forecourt leaves nothing
 * to read. The tab bar stopped responding on somebody's phone, every
 * static check came back clean, and there was no record on the device of
 * what actually happened. This is the smallest thing that fixes that: a
 * global handler that writes the error to the same SQLite cache
 * everything else uses, and an admin card that shows it.
 *
 * Deliberately tiny and dependency-free. A crash reporting service is a
 * bigger decision (data leaves the device, POPIA applies); this keeps the
 * evidence local and lets a person choose to share it.
 */
import { readCache, writeCache } from '../db/cache';

export interface CrashRecord {
  message: string;
  stack: string | null;
  isFatal: boolean;
  at: string;
}

const KEY = 'crash:last';

export function installCrashJournal(): void {
  const previous = ErrorUtils.getGlobalHandler?.();
  ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
    try {
      const record: CrashRecord = {
        message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        isFatal: Boolean(isFatal),
        at: new Date().toISOString(),
      };
      writeCache(KEY, record);
    } catch {
      // The journal must never make a crash worse.
    }
    previous?.(error, isFatal);
  });
}

export function lastCrash(): CrashRecord | null {
  try {
    return readCache<CrashRecord>(KEY);
  } catch {
    return null;
  }
}

export function clearCrash(): void {
  try {
    writeCache(KEY, null);
  } catch {
    // Nothing to do; the card will simply show it again.
  }
}
