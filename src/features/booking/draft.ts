import type { Contacts } from '@/lib/validation';
import { myBookings } from '@/lib/my-bookings';

const key = (slug: string) => `studio:${slug}:contacts-draft`;

export function readDraft(slug: string): Contacts {
  try {
    const raw = sessionStorage.getItem(key(slug));
    if (raw) return { ...(JSON.parse(raw) as Contacts) };
  } catch {
    /* ignore */
  }
  const last = myBookings.lastContacts(slug);
  return { name: last?.name ?? '', phone: last?.phone ?? '', car: last?.car ?? '', comment: '' };
}

export function writeDraft(slug: string, c: Contacts) {
  try {
    sessionStorage.setItem(key(slug), JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

export function clearDraft(slug: string) {
  try {
    sessionStorage.removeItem(key(slug));
  } catch {
    /* ignore */
  }
}
