// Bookings made on this device: only the access token and a cached copy of
// the client's own booking, per studio. Nothing about other clients.
import type { PublicBooking } from './types';

export interface SavedBooking {
  token: string;
  id: string;
  starts_at: string;
  saved_at: string;
  snapshot?: PublicBooking;
}

const key = (slug: string) => `studio:${slug}:my-bookings`;

function read(slug: string): SavedBooking[] {
  try {
    const raw = localStorage.getItem(key(slug));
    const list = raw ? (JSON.parse(raw) as SavedBooking[]) : [];
    return Array.isArray(list) ? list.filter((b) => typeof b.token === 'string') : [];
  } catch {
    return [];
  }
}

function write(slug: string, list: SavedBooking[]) {
  try {
    localStorage.setItem(key(slug), JSON.stringify(list.slice(0, 20)));
  } catch {
    /* storage full or disabled: the booking still exists on the server */
  }
}

export const myBookings = {
  list: read,
  save(slug: string, b: PublicBooking & { access_token: string }) {
    const { access_token, ...snapshot } = b;
    const list = read(slug).filter((x) => x.token !== access_token);
    list.unshift({ token: access_token, id: b.id, starts_at: b.starts_at, saved_at: new Date().toISOString(), snapshot });
    write(slug, list);
  },
  updateSnapshot(slug: string, token: string, snapshot: PublicBooking) {
    write(slug, read(slug).map((x) => (x.token === token ? { ...x, starts_at: snapshot.starts_at, snapshot } : x)));
  },
  remove(slug: string, token: string) {
    write(slug, read(slug).filter((x) => x.token !== token));
  },
  lastContacts(slug: string) {
    const s = read(slug).find((x) => x.snapshot)?.snapshot;
    return s ? { name: s.customer_name, phone: s.customer_phone, car: s.car } : null;
  },
};
