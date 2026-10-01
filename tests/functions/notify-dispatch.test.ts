// Runs the real Edge Function code under Deno against the local gateway and
// a fresh database, with a MOCK push service on localhost. This proves the
// outbox → Edge Function → encrypted Web Push request → completion loop.
// It does NOT prove delivery through Apple/Google/Mozilla push services;
// that check needs a deployed site and a real device (see ACCEPTANCE.md).
import { spawn, type ChildProcess } from 'node:child_process';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { b64urlEncode, concat, hkdf } from '../../supabase/functions/_shared/webpush.ts';
import { generateVapidKeys } from '../../scripts/lib/vapid.ts';
import { serviceKey } from '../../scripts/local/env.ts';
import { anon, createTestDb, PG_URL, type TestDb } from '../db/harness.ts';
import { book, setupStudio } from '../db/fixtures.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GW_PORT = 54361;
const FN_PORT = 54362;
const PUSH_PORT = 54363;
const SECRET = 'test-cron-secret-0123456789';

let db: TestDb;
let gateway: ChildProcess;
let fn: ChildProcess;
let pushServer: http.Server;
const received: { path: string; headers: http.IncomingHttpHeaders; body: Buffer }[] = [];

async function waitFor(url: string, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.status) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timeout waiting for ${url}`);
}

async function subscriber() {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, pub, auth };
}

async function decrypt(body: Uint8Array, ua: Awaited<ReturnType<typeof subscriber>>) {
  const enc = new TextEncoder();
  const salt = body.slice(0, 16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.keys.privateKey, 256));
  const ikm = await hkdf(ua.auth, ecdh, concat(enc.encode('WebPush: info\0'), ua.pub, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(21 + idlen)));
  return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
}

describe('notify-dispatch Edge Function (Deno, local)', () => {
  const vapid = { publicKey: '', privateKey: '' };

  beforeAll(async () => {
    db = await createTestDb();
    Object.assign(vapid, await generateVapidKeys());
    pushServer = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        received.push({ path: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(req.url?.startsWith('/gone') ? 410 : 201).end();
      });
    });
    await new Promise<void>((r) => pushServer.listen(PUSH_PORT, '127.0.0.1', r));

    const dbUrl = PG_URL.replace(/\/[^/]*$/, `/${db.name}`);
    gateway = spawn(process.execPath, ['--import', 'tsx', 'scripts/local/gateway.ts'], {
      cwd: ROOT,
      env: { ...process.env, LOCAL_DB_URL: dbUrl, GATEWAY_PORT: String(GW_PORT) },
      stdio: 'ignore',
    });
    fn = spawn(path.join(ROOT, 'node_modules/deno/deno'), ['run', '--allow-net', '--allow-env', '--no-prompt', 'supabase/functions/notify-dispatch/index.ts'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(FN_PORT),
        SUPABASE_URL: `http://127.0.0.1:${GW_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: await serviceKey(),
        VAPID_PUBLIC_KEY: vapid.publicKey,
        VAPID_PRIVATE_KEY: vapid.privateKey,
        VAPID_SUBJECT: 'mailto:test@example.invalid',
        NOTIFY_CRON_SECRET: SECRET,
      },
      stdio: 'ignore',
    });
    await waitFor(`http://127.0.0.1:${GW_PORT}/health`);
    await waitFor(`http://127.0.0.1:${FN_PORT}/`);
  }, 120_000);

  afterAll(async () => {
    gateway?.kill();
    fn?.kill();
    pushServer?.close();
    await db?.close();
  });

  it('rejects calls without the cron secret', async () => {
    const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST', headers: { 'x-cron-secret': 'wrong' } });
    expect(r.status).toBe(401);
  });

  it('sends due reminders encrypted, drops gone devices, never twice', async () => {
    const s = await setupStudio(db, 'push-studio');
    // A booking two days ahead, reminder due "now" (we move run_at).
    // Use a slot inside working hours: next weekday 11:00 Moscow.
    const d = new Date(Date.now() + 2 * 86400_000);
    while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
    const day = d.toISOString().slice(0, 10);
    const b = await book(db, anon(), s.slug, s.service.wash!, new Date(`${day}T11:00:00+03:00`).toISOString());

    const phone = await subscriber();
    const old = await subscriber();
    for (const [n, ua] of [
      [1, phone],
      [2, old],
    ] as const) {
      await db.rpc(anon(), 'public_save_push_subscription', {
        p_slug: s.slug,
        p_token: b.access_token,
        p_endpoint: `https://push.example.net/sub/${n}`,
        p_p256dh: b64urlEncode(ua.pub),
        p_auth: b64urlEncode(ua.auth),
      });
    }
    // Point the stored endpoints at the local mock push service. Production
    // only accepts https endpoints; this throwaway test database relaxes that
    // one check so a plain-http mock on localhost can stand in for FCM/APNs.
    await db.admin(`alter table public.push_subscriptions drop constraint push_subscriptions_endpoint_check`);
    await db.admin(`update public.push_subscriptions set endpoint = replace(endpoint, 'https://push.example.net/sub/1', 'http://127.0.0.1:${PUSH_PORT}/ok/1')`);
    await db.admin(`update public.push_subscriptions set endpoint = replace(endpoint, 'https://push.example.net/sub/2', 'http://127.0.0.1:${PUSH_PORT}/gone/2')`);
    await db.admin(`update public.notification_jobs set run_at = now() - interval '1 minute' where booking_id = $1`, [b.id]);

    const r = await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST', headers: { 'x-cron-secret': SECRET } });
    expect(r.status).toBe(200);
    const summary = await r.json();
    expect(summary).toMatchObject({ claimed: 1, sent: 1, failed: 0, gone: 1 });

    const ok = received.find((x) => x.path === '/ok/1')!;
    expect(ok.headers['content-encoding']).toBe('aes128gcm');
    expect(ok.headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));
    const payload = await decrypt(new Uint8Array(ok.body), phone);
    expect(payload.title).toContain('Wash');
    expect(payload.url).toBe('/s/push-studio/my');

    const [job] = await db.admin(`select status, sent_at from public.notification_jobs where booking_id = $1`, [b.id]);
    expect(job.status).toBe('sent');
    const subs = await db.admin(`select endpoint from public.push_subscriptions where booking_id = $1`, [b.id]);
    expect(subs.map((x) => x.endpoint)).toEqual([`http://127.0.0.1:${PUSH_PORT}/ok/1`]);

    const again = await (await fetch(`http://127.0.0.1:${FN_PORT}/`, { method: 'POST', headers: { 'x-cron-secret': SECRET } })).json();
    expect(again.claimed).toBe(0);
    expect(received.filter((x) => x.path === '/ok/1')).toHaveLength(1);
  });
});
