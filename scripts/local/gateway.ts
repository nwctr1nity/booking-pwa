// LOCAL EMULATOR of the subset of the Supabase HTTP API this app uses, backed
// by a real PostgreSQL database with our migrations:
//   /rest/v1/rpc/<fn>      executed like PostgREST (SET LOCAL ROLE + JWT claims GUCs)
//   /auth/v1/token, /user, /logout, /admin/users   (email + password only)
//   /storage/v1/object/... upload (RLS on storage.objects enforced) and public read
//   /functions/v1/<name>   proxied to `deno serve` of supabase/functions
// It exists because the Supabase Docker stack cannot be pulled in this
// environment. It is NOT Supabase; integration against a real project is
// listed separately in ACCEPTANCE.md.
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { jwtVerify } from 'jose';
import pg from 'pg';
import { FUNCTIONS_URL, GATEWAY_PORT, jwtKey, LOCAL_DB_URL, MEDIA_DIR, signJwt } from './env.ts';

const pool = new pg.Pool({ connectionString: LOCAL_DB_URL, max: 20 });
const refreshTokens = new Map<string, string>(); // refresh token -> user id

type Claims = { role: 'anon' | 'authenticated' | 'service_role'; sub?: string; email?: string };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version, prefer, accept-profile, content-profile, x-upsert, cache-control',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, x-supabase-api-version',
};

function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

async function readBody(req: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

async function claimsOf(req: http.IncomingMessage): Promise<Claims> {
  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '') ?? (req.headers.apikey as string | undefined);
  if (!auth) throw Object.assign(new Error('missing token'), { status: 401 });
  try {
    const { payload } = await jwtVerify(auth, jwtKey);
    return payload as unknown as Claims;
  } catch {
    throw Object.assign(new Error('invalid JWT'), { status: 401 });
  }
}

function clientIp(req: http.IncomingMessage) {
  return (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

async function inRole<T>(claims: Claims, req: http.IncomingMessage, run: (c: pg.PoolClient) => Promise<T>) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(
      `select set_config('role', $1, true), set_config('request.jwt.claims', $2, true), set_config('request.headers', $3, true)`,
      [claims.role, JSON.stringify(claims), JSON.stringify({ 'x-forwarded-for': clientIp(req), 'user-agent': req.headers['user-agent'] ?? '' })],
    );
    const out = await run(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

function pgError(res: http.ServerResponse, e: unknown, claims?: Claims) {
  const err = e as pg.DatabaseError & { status?: number };
  if (err.status) return send(res, err.status, { code: 'PGRST301', message: err.message });
  const status = err.code === '42501' ? (claims?.role === 'anon' ? 401 : 403)
    : err.code === '42883' ? 404
    : err.code === 'P0001' || err.code?.startsWith('22') || err.code?.startsWith('23') ? 400
    : 500;
  send(res, status, { code: err.code ?? 'XX000', message: err.message, details: err.detail ?? null, hint: err.hint ?? null });
}

// ---------------------------------------------------------------- REST (rpc)
async function rpc(req: http.IncomingMessage, res: http.ServerResponse, fn: string) {
  let claims: Claims | undefined;
  try {
    claims = await claimsOf(req);
    if (!/^[a-z_][a-z0-9_]*$/.test(fn)) return send(res, 404, { code: 'PGRST202', message: 'function not found' });
    const raw = (await readBody(req)).toString('utf8');
    const args = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
    const keys = Object.keys(args);
    for (const k of keys) if (!/^[a-z_][a-z0-9_]*$/.test(k)) return send(res, 400, { message: 'bad argument name' });
    const values = keys.map((k) => {
      const v = args[k];
      const isJson = v !== null && typeof v === 'object' && (!Array.isArray(v) || v.some((x) => x !== null && typeof x === 'object'));
      return isJson ? JSON.stringify(v) : v;
    });
    const sql = `select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as v`;
    const v = await inRole(claims, req, async (c) => (await c.query(sql, values)).rows[0]?.v);
    send(res, 200, v ?? null);
  } catch (e) {
    pgError(res, e, claims);
  }
}

// ---------------------------------------------------------------- Auth
async function session(userId: string) {
  const { rows } = await pool.query(`select id, email, created_at from auth.users where id = $1`, [userId]);
  const u = rows[0];
  const expiresIn = 3600;
  const access = await signJwt({ role: 'authenticated', sub: u.id, email: u.email, aud: 'authenticated', session_id: randomUUID() }, expiresIn);
  const refresh = randomBytes(24).toString('hex');
  refreshTokens.set(refresh, u.id);
  return {
    access_token: access,
    token_type: 'bearer',
    expires_in: expiresIn,
    expires_at: Math.floor(Date.now() / 1000) + expiresIn,
    refresh_token: refresh,
    user: userJson(u),
  };
}

function userJson(u: { id: string; email: string; created_at: Date }) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: u.created_at, app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {}, identities: [], created_at: u.created_at, updated_at: u.created_at,
  };
}

async function auth(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const p = url.pathname.replace('/auth/v1', '');
  try {
    if (p === '/token' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const grant = url.searchParams.get('grant_type');
      if (grant === 'password') {
        const { rows } = await pool.query(
          `select id from auth.users where lower(email) = lower($1) and encrypted_password = extensions.crypt($2, encrypted_password)`,
          [body.email ?? '', body.password ?? ''],
        );
        if (!rows[0]) return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials', error: 'invalid_grant', error_description: 'Invalid login credentials' });
        return send(res, 200, await session(rows[0].id));
      }
      if (grant === 'refresh_token') {
        const uid = refreshTokens.get(body.refresh_token);
        if (!uid) return send(res, 400, { code: 'refresh_token_not_found', error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
        refreshTokens.delete(body.refresh_token);
        return send(res, 200, await session(uid));
      }
      return send(res, 400, { msg: 'unsupported grant_type' });
    }
    if (p === '/user' && req.method === 'GET') {
      const c = await claimsOf(req);
      if (c.role !== 'authenticated' || !c.sub) return send(res, 401, { code: 'no_authorization', msg: 'not signed in' });
      const { rows } = await pool.query(`select id, email, created_at from auth.users where id = $1`, [c.sub]);
      if (!rows[0]) return send(res, 404, { code: 'user_not_found', msg: 'user not found' });
      return send(res, 200, userJson(rows[0]));
    }
    if (p === '/logout' && req.method === 'POST') {
      res.writeHead(204, CORS);
      return res.end();
    }
    if (p === '/signup') {
      return send(res, 422, { code: 'signup_disabled', error_code: 'signup_disabled', msg: 'Signups not allowed for this instance' });
    }
    if (p === '/admin/users') {
      const c = await claimsOf(req);
      if (c.role !== 'service_role') return send(res, 403, { msg: 'service role required' });
      if (req.method === 'POST') {
        const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
        const { rows } = await pool.query(
          `insert into auth.users(instance_id, aud, role, email, encrypted_password, raw_app_meta_data)
           values ('00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', lower($1), extensions.crypt($2, extensions.gen_salt('bf')), '{"provider":"email"}')
           on conflict (email) do nothing returning id, email, created_at`,
          [body.email, body.password ?? randomBytes(12).toString('hex')],
        );
        if (!rows[0]) return send(res, 422, { code: 'email_exists', error_code: 'email_exists', msg: 'A user with this email address has already been registered' });
        return send(res, 200, userJson(rows[0]));
      }
      const { rows } = await pool.query(`select id, email, created_at from auth.users order by created_at`);
      return send(res, 200, { users: rows.map(userJson), aud: 'authenticated' });
    }
    const m = p.match(/^\/admin\/users\/([0-9a-f-]{36})$/);
    if (m && req.method === 'PUT') {
      const c = await claimsOf(req);
      if (c.role !== 'service_role') return send(res, 403, { msg: 'service role required' });
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      if (body.password) await pool.query(`update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt('bf')) where id = $1`, [m[1], body.password]);
      const { rows } = await pool.query(`select id, email, created_at from auth.users where id = $1`, [m[1]]);
      return send(res, 200, userJson(rows[0]));
    }
    send(res, 404, { msg: 'not implemented in local gateway' });
  } catch (e) {
    pgError(res, e);
  }
}

// ---------------------------------------------------------------- Storage
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif' };

async function storage(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const pub = url.pathname.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (pub && (req.method === 'GET' || req.method === 'HEAD')) {
    const [, bucket, name] = pub;
    const file = path.join(MEDIA_DIR, bucket, decodeURIComponent(name));
    if (!file.startsWith(MEDIA_DIR) || !existsSync(file)) return send(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { ...CORS, 'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'public, max-age=60' });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file).pipe(res);
  }
  const up = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
  if (up && (req.method === 'POST' || req.method === 'PUT')) {
    let claims: Claims | undefined;
    try {
      claims = await claimsOf(req);
      const [, bucket, rawName] = up;
      const name = decodeURIComponent(rawName);
      if (name.includes('..')) return send(res, 400, { message: 'bad path' });
      const raw = await readBody(req);
      let bytes = raw;
      let type = (req.headers['content-type'] ?? '').split(';')[0];
      if (type === 'multipart/form-data') {
        const form = await new Request('http://local/', { method: 'POST', headers: { 'content-type': req.headers['content-type']! }, body: new Uint8Array(raw) }).formData();
        const file = [...form.values()].find((v) => typeof v !== 'string') as File | undefined;
        if (!file) return send(res, 400, { message: 'no file' });
        bytes = Buffer.from(await file.arrayBuffer());
        type = file.type;
      }
      const upsert = req.headers['x-upsert'] === 'true' || req.method === 'PUT';
      const result = await inRole(claims, req, async (c) => {
        const b = (await c.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = $1`, [bucket])).rows[0];
        if (!b) throw Object.assign(new Error('Bucket not found'), { status: 404 });
        if (b.file_size_limit && bytes.length > Number(b.file_size_limit)) throw Object.assign(new Error('The object exceeded the maximum allowed size'), { status: 413 });
        if (b.allowed_mime_types && !b.allowed_mime_types.includes(type)) throw Object.assign(new Error(`mime type ${type} is not supported`), { status: 415 });
        const sql = upsert
          ? `insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, $3, $4)
             on conflict (bucket_id, name) do update set updated_at = now(), metadata = excluded.metadata returning id`
          : `insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id`;
        return (await c.query(sql, [bucket, name, claims!.sub ?? null, JSON.stringify({ mimetype: type, size: bytes.length })])).rows[0];
      });
      const file = path.join(MEDIA_DIR, bucket, name);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      return send(res, 200, { Key: `${bucket}/${name}`, Id: result.id, id: result.id, path: name, fullPath: `${bucket}/${name}` });
    } catch (e) {
      const err = e as { status?: number; code?: string; message: string };
      if (err.code === '42501') return send(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      if (err.code === '23505') return send(res, 409, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      if (err.status) return send(res, err.status, { statusCode: String(err.status), error: 'error', message: err.message });
      return pgError(res, e, claims);
    }
  }
  send(res, 404, { message: 'not implemented in local gateway' });
}

// ---------------------------------------------------------------- Functions
async function functions(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const target = FUNCTIONS_URL + url.pathname.replace('/functions/v1', '') + url.search;
  try {
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
    const r = await fetch(target, { method: req.method, headers: req.headers as Record<string, string>, body: body && new Uint8Array(body) });
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { ...CORS, 'content-type': r.headers.get('content-type') ?? 'application/json' });
    res.end(buf);
  } catch (e) {
    send(res, 502, { message: `functions runtime not reachable at ${FUNCTIONS_URL}: ${(e as Error).message}` });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  const url = new URL(req.url ?? '/', 'http://local');
  const m = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
  if (m && req.method === 'POST') return rpc(req, res, m[1]);
  if (url.pathname.startsWith('/auth/v1/')) return auth(req, res, url);
  if (url.pathname.startsWith('/storage/v1/')) return storage(req, res, url);
  if (url.pathname.startsWith('/functions/v1/')) return functions(req, res, url);
  if (url.pathname === '/health') return send(res, 200, { ok: true });
  send(res, 404, { message: 'not implemented in local gateway' });
});

server.listen(GATEWAY_PORT, '0.0.0.0', () => {
  console.log(`local gateway on http://127.0.0.1:${GATEWAY_PORT} -> ${LOCAL_DB_URL}`);
});
