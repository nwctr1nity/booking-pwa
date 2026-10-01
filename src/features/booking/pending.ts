// The idempotency key of a booking that is being sent. It survives a reload
// or a lost response: re-sending the same request returns the same booking
// and the same access token instead of a duplicate.
import { newRequestKey } from '@/lib/ids';

interface Pending {
  key: string;
  fingerprint: string;
}

const storageKey = (slug: string) => `studio:${slug}:pending-booking`;

export function pendingKeyFor(slug: string, fingerprint: string): string {
  try {
    const raw = sessionStorage.getItem(storageKey(slug));
    const p = raw ? (JSON.parse(raw) as Pending) : null;
    if (p && p.fingerprint === fingerprint) return p.key;
    const key = newRequestKey();
    sessionStorage.setItem(storageKey(slug), JSON.stringify({ key, fingerprint }));
    return key;
  } catch {
    return newRequestKey();
  }
}

export function clearPending(slug: string) {
  try {
    sessionStorage.removeItem(storageKey(slug));
  } catch {
    /* ignore */
  }
}
