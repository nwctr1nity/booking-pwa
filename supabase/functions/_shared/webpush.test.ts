import { describe, expect, it } from 'vitest';
import { importJWK, jwtVerify } from 'jose';
import { b64urlDecode, b64urlEncode, concat, encryptPayload, hkdf, sendPush, vapidAuthorization } from './webpush.ts';

const enc = new TextEncoder();

async function makeSubscriber() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, sub: { endpoint: 'https://push.example.net/send/abc', keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) } }, pub, auth };
}

// Independent receiver-side implementation of RFC 8291 decryption, as a browser does it.
async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof makeSubscriber>>) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.keys.privateKey, 256));
  const ikm = await hkdf(ua.auth, ecdh, concat(enc.encode('WebPush: info\0'), ua.pub, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
  expect(plain[plain.length - 1]).toBe(2);
  return { rs, text: new TextDecoder().decode(plain.slice(0, -1)) };
}

async function makeVapid() {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return { publicKey: b64urlEncode(pub), privateKey: jwk.d!, subject: 'mailto:ops@example.com', jwk };
}

describe('web push (RFC 8291 / 8292)', () => {
  it('encrypts a payload the subscriber can decrypt', async () => {
    const ua = await makeSubscriber();
    const msg = JSON.stringify({ title: 'Напоминание', body: 'Завтра в 10:00' });
    const body = await encryptPayload(ua.sub, enc.encode(msg));
    const out = await decrypt(body, ua);
    expect(out.text).toBe(msg);
    expect(out.rs).toBe(4096);
  });

  it('uses a fresh salt and server key per message', async () => {
    const ua = await makeSubscriber();
    const a = await encryptPayload(ua.sub, enc.encode('x'));
    const b = await encryptPayload(ua.sub, enc.encode('x'));
    expect(b64urlEncode(a.slice(0, 16))).not.toBe(b64urlEncode(b.slice(0, 16)));
    expect(b64urlEncode(a.slice(21, 86))).not.toBe(b64urlEncode(b.slice(21, 86)));
  });

  it('signs a VAPID JWT for the push service origin', async () => {
    const v = await makeVapid();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/xyz', v, 1_800_000_000);
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(header)!;
    expect(m[2]).toBe(v.publicKey);
    const key = await importJWK({ kty: 'EC', crv: 'P-256', x: v.jwk.x, y: v.jwk.y }, 'ES256');
    const { payload } = await jwtVerify(m[1]!, key, { currentDate: new Date(1_800_000_000 * 1000) });
    expect(payload.aud).toBe('https://fcm.googleapis.com');
    expect(payload.sub).toBe('mailto:ops@example.com');
    expect(payload.exp).toBe(1_800_000_000 + 12 * 3600);
  });

  it('reports 410 as a gone subscription', async () => {
    const ua = await makeSubscriber();
    const v = await makeVapid();
    const calls: RequestInit[] = [];
    const fake = (async (_u: string, init: RequestInit) => {
      calls.push(init);
      return new Response('gone', { status: 410 });
    }) as unknown as typeof fetch;
    const r = await sendPush(ua.sub, { a: 1 }, v, { fetchImpl: fake });
    expect(r).toMatchObject({ ok: false, gone: true, status: 410 });
    const h = calls[0]!.headers as Record<string, string>;
    expect(h['content-encoding']).toBe('aes128gcm');
    expect(h.authorization).toMatch(/^vapid t=/);
    const decoded = await decrypt(calls[0]!.body as Uint8Array, ua);
    expect(JSON.parse(decoded.text)).toEqual({ a: 1 });
    expect(b64urlDecode(ua.sub.keys.auth)).toHaveLength(16);
  });
});
