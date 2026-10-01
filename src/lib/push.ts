// Web Push capability and subscription for one booking. Honest states only:
// the server decides whether a reminder is scheduled (booking.reminder.state).
import { env } from '@/env';
import { rpc } from './api';
import { ApiError } from './errors';

export type PushSupport =
  | { kind: 'supported' }
  | { kind: 'ios-needs-install' }
  | { kind: 'denied' }
  | { kind: 'unsupported'; reason: 'no-api' | 'no-key' | 'insecure' };

export function isStandalone() {
  return (
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return { kind: 'unsupported', reason: 'no-api' };
  if (!window.isSecureContext) return { kind: 'unsupported', reason: 'insecure' };
  if (!env.vapidPublicKey) return { kind: 'unsupported', reason: 'no-key' };
  const hasApi = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // Safari on iPhone exposes Web Push only to a site added to the Home Screen.
  if (isIos() && !isStandalone()) return { kind: 'ios-needs-install' };
  if (!hasApi) return { kind: 'unsupported', reason: 'no-api' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  return { kind: 'supported' };
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function toBase64Url(buf: ArrayBuffer | null) {
  if (!buf) return '';
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function readyRegistration(timeoutMs = 8000) {
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((r) => setTimeout(() => r(null), timeoutMs)),
  ]);
  if (!reg) throw new ApiError('sw_unavailable');
  return reg;
}

/** Ask permission, subscribe this device and attach it to the booking. */
export async function subscribeReminder(slug: string, token: string) {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new ApiError('push_denied');
  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(env.vapidPublicKey),
    });
  }
  await rpc('public_save_push_subscription', {
    p_slug: slug,
    p_token: token,
    p_endpoint: sub.endpoint,
    p_p256dh: toBase64Url(sub.getKey('p256dh')),
    p_auth: toBase64Url(sub.getKey('auth')),
  });
}

export async function unsubscribeReminder(slug: string, token: string) {
  const reg = await readyRegistration();
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await rpc('public_remove_push_subscription', { p_slug: slug, p_token: token, p_endpoint: sub.endpoint });
}
