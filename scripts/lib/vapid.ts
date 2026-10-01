import { b64urlEncode } from '../../supabase/functions/_shared/webpush.ts';

/** New VAPID key pair in the format Web Push and the Edge Function expect. */
export async function generateVapidKeys() {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d! };
}
