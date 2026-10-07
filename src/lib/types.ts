export interface InfoCard {
  icon?: string;
  title: string;
  text: string;
}

export interface Service {
  id: string;
  name: string;
  description: string;
  category: string;
  price_cents: number;
  price_is_from: boolean;
  duration_minutes: number;
}

export interface GalleryItem {
  id: string;
  image_path: string;
  caption: string;
  updated_at?: string;
  sort?: number;
}

export interface HoursRow {
  weekday: number;
  opens: string;
  closes: string;
}

export interface ScheduleException {
  day: string;
  is_closed: boolean;
  opens: string | null;
  closes: string | null;
  note: string;
}

export interface Studio {
  id: string;
  slug: string;
  status: 'preview' | 'live';
  is_preview: boolean;
  kind?: 'detailing' | 'service' | 'tire' | 'wash' | 'beauty' | 'other';
  name: string;
  short_name: string;
  timezone: string;
  currency: string;
  locale: string;
  accent_color: string;
  tagline: string;
  description: string;
  address: string;
  address_note: string;
  map_url: string | null;
  phone: string;
  info_cards: InfoCard[];
  logo_path: string | null;
  hero_path: string | null;
  cancellation_hours: number;
  reminder_hours: number;
  horizon_days: number;
  services: Service[];
  gallery: GalleryItem[];
  hours: HoursRow[];
  exceptions: ScheduleException[];
}

export interface Slot {
  starts_at: string;
  available: boolean;
}

export interface SlotDay {
  date: string;
  is_open: boolean;
  slots: Slot[];
}

export interface SlotsResponse {
  timezone: string;
  from: string;
  to: string;
  days: SlotDay[];
}

export type ReminderState = 'not_subscribed' | 'scheduled' | 'too_late' | 'preview' | 'sent' | 'failed' | 'inactive' | 'unknown';

export interface PublicBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  service_name: string;
  price_cents: number;
  price_is_from: boolean;
  duration_minutes: number;
  customer_name: string;
  customer_phone: string;
  car: string;
  comment: string;
  resource_name: string;
  is_demo: boolean;
  cancel_deadline: string;
  can_cancel: boolean;
  reminder: { state: ReminderState; run_at: string | null; subscriptions: number };
  studio: { slug: string; name: string; address: string; phone: string; timezone: string; currency: string; map_url: string | null; cancellation_hours: number; reminder_hours: number };
  access_token?: string;
  replayed?: boolean;
}

export type BookingStatus = 'confirmed' | 'arrived' | 'done' | 'cancelled' | 'no_show';

export interface Payment {
  id: string;
  kind: 'payment' | 'refund';
  amount_cents: number;
  method: 'cash' | 'card' | 'transfer' | 'other';
  paid_at: string;
  note: string;
}

export interface OwnerBooking {
  id: string;
  status: BookingStatus;
  starts_at: string;
  ends_at: string;
  occupied_until: string;
  service_id: string;
  service_name: string;
  price_cents: number;
  price_is_from: boolean;
  duration_minutes: number;
  resource_id: string;
  resource_name: string;
  customer_name: string;
  customer_phone: string;
  car: string;
  comment: string;
  source: 'client' | 'owner' | 'demo';
  is_demo: boolean;
  version: number;
  arrived_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancel_reason: string;
  paid_cents: number;
  refunded_cents: number;
  payments: Payment[];
}

export interface OwnerBlock {
  id: string;
  resource_id: string;
  resource_name: string;
  starts_at: string;
  ends_at: string;
  note: string;
}

export interface OwnerBookings {
  timezone: string;
  from: string;
  to: string;
  bookings: OwnerBooking[];
  blocks: OwnerBlock[];
}

export interface OwnerStats {
  timezone: string;
  currency: string;
  from: string;
  to: string;
  arrivals: number;
  scheduled: number;
  completed: number;
  cancelled: number;
  no_show: number;
  received_cents: number;
  refunded_cents: number;
  net_cents: number;
  planned_value_cents: number;
}

export interface OwnerTenant {
  id: string;
  slug: string;
  name: string;
  status: string;
  role: string;
  timezone: string;
  currency: string;
}

export interface SettingsService extends Service {
  buffer_minutes: number;
  is_active: boolean;
  sort: number;
  resource_ids: string[];
}

export interface SettingsResource {
  id: string;
  name: string;
  is_active: boolean;
  sort: number;
}

export interface OwnerSettings {
  tenant: Omit<Studio, 'services' | 'gallery' | 'hours' | 'exceptions' | 'is_preview' | 'locale' | 'reminder_hours'> & {
    slot_step_minutes: number;
    min_notice_minutes: number;
    horizon_days: number;
  };
  resources: SettingsResource[];
  services: SettingsService[];
  hours: HoursRow[];
  exceptions: ScheduleException[];
  gallery: GalleryItem[];
}
