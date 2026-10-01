// Supabase Edge Function, called every 5 minutes by Supabase Cron
// (pg_cron + pg_net, see migration 20261001000900_cron.sql) with the
// x-cron-secret header. Secrets (Edge Function secrets, never in the client):
//   NOTIFY_CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform;
// SUPABASE_SECRET_KEY (sb_secret_…), if set as a function secret, wins.
import { dispatch } from './dispatch.ts';

declare const Deno: { env: { get(k: string): string | undefined }; serve: (opts: { port?: number } | ((req: Request) => Promise<Response>), h?: (req: Request) => Promise<Response>) => unknown };

function env(name: string) {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  let secret: string;
  try {
    secret = env('NOTIFY_CRON_SECRET');
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', secret)) return json(401, { error: 'unauthorized' });

  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: serviceKey, ...(serviceKey.startsWith('eyJ') ? { authorization: `Bearer ${serviceKey}` } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(`${fn}: ${r.status} ${JSON.stringify(body).slice(0, 200)}`);
    return body;
  };

  try {
    const summary = await dispatch(rpc, { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT') });
    console.log(JSON.stringify({ event: 'notify-dispatch', ...summary }));
    return json(200, summary);
  } catch (e) {
    console.error(e);
    return json(500, { error: (e as Error).message });
  }
}

const port = Deno.env.get('PORT');
if (port) Deno.serve({ port: Number(port) }, handler);
else Deno.serve(handler);
