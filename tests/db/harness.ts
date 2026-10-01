// Integration-test harness: a fresh PostgreSQL database per test file with
// the local Supabase shim + all migrations. Calls are executed the way
// PostgREST executes them: inside a transaction, SET LOCAL ROLE to the JWT
// role, request.jwt.claims and request.headers set as GUCs.
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const ROOT = path.resolve(import.meta.dirname, '../..');
export const PG_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:54322/postgres';

export type Role = 'anon' | 'authenticated' | 'service_role';
export interface Caller {
  role: Role;
  sub?: string;
  ip?: string;
}
export const anon = (ip = '203.0.113.1'): Caller => ({ role: 'anon', ip });
export const service: Caller = { role: 'service_role', ip: '127.0.0.1' };
export const user = (sub: string, ip = '198.51.100.7'): Caller => ({ role: 'authenticated', sub, ip });

export function migrationFiles() {
  const dir = path.join(ROOT, 'supabase/migrations');
  return readdirSync(dir).filter((f) => f.endsWith('.sql')).sort().map((f) => path.join(dir, f));
}

export async function applySchema(client: pg.Client | pg.PoolClient) {
  await client.query(readFileSync(path.join(ROOT, 'supabase/local/shim.sql'), 'utf8'));
  for (const f of migrationFiles()) {
    try {
      await client.query(readFileSync(f, 'utf8'));
    } catch (e) {
      throw new Error(`${path.basename(f)}: ${(e as Error).message}`);
    }
  }
}

export class DbError extends Error {
  constructor(public code: string, message: string, public hint?: string) {
    super(message);
  }
}

export interface TestDb {
  name: string;
  pool: pg.Pool;
  rpc<T = any>(caller: Caller, fn: string, args?: Record<string, unknown>): Promise<T>;
  sql<T = any>(caller: Caller, text: string, params?: unknown[]): Promise<T[]>;
  admin<T = any>(text: string, params?: unknown[]): Promise<T[]>;
  close(): Promise<void>;
}

export async function createTestDb(): Promise<TestDb> {
  const name = `t_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const root = new pg.Client({ connectionString: PG_URL });
  await root.connect();
  await root.query(`create database ${name}`);
  await root.end();

  const url = PG_URL.replace(/\/[^/]*$/, `/${name}`);
  const setup = new pg.Client({ connectionString: url });
  await setup.connect();
  await applySchema(setup);
  await setup.end();

  const pool = new pg.Pool({ connectionString: url, max: 20 });

  async function inRole<T>(caller: Caller, run: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('role', $1, true),
                            set_config('request.jwt.claims', $2, true),
                            set_config('request.headers', $3, true)`, [
        caller.role,
        JSON.stringify({ role: caller.role, ...(caller.sub ? { sub: caller.sub } : {}) }),
        JSON.stringify({ 'x-forwarded-for': caller.ip ?? '192.0.2.10' }),
      ]);
      const out = await run(c);
      await c.query('commit');
      return out;
    } catch (e) {
      await c.query('rollback').catch(() => {});
      const err = e as pg.DatabaseError;
      if (err.code) throw new DbError(err.code, err.message, err.hint);
      throw e;
    } finally {
      c.release();
    }
  }

  return {
    name,
    pool,
    rpc(caller, fn, args = {}) {
      const keys = Object.keys(args);
      const list = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
      return inRole(caller, async (c) => {
        const r = await c.query(`select public.${fn}(${list}) as v`, keys.map((k) => {
          const v = args[k];
          const isJson = v !== null && typeof v === 'object' && !(v instanceof Date) &&
            (!Array.isArray(v) || v.some((x) => x !== null && typeof x === 'object'));
          return isJson ? JSON.stringify(v) : v;
        }));
        return r.rows[0]?.v;
      }).then((v) => {
        // public_* functions report expected errors as {"error": code} in a
        // committed response (so the rate-limit hit sticks); surface them
        // like raised errors, as the frontend API layer does.
        if (v && typeof v === 'object' && typeof v.error === 'string') throw new DbError('P0001', v.error, v.hint ?? undefined);
        return v;
      });
    },
    sql(caller, text, params = []) {
      return inRole(caller, async (c) => (await c.query(text, params)).rows);
    },
    async admin(text, params = []) {
      return (await pool.query(text, params)).rows;
    },
    async close() {
      await pool.end();
      const r = new pg.Client({ connectionString: PG_URL });
      await r.connect();
      await r.query(`drop database if exists ${name} with (force)`);
      await r.end();
    },
  };
}

export function idem() {
  return randomUUID().replace(/-/g, '');
}

export async function createOwner(db: TestDb, email: string, slug?: string) {
  const [u] = await db.admin(
    `insert into auth.users(email, encrypted_password) values ($1, extensions.crypt('secret-pass', extensions.gen_salt('bf'))) returning id`,
    [email],
  );
  if (slug) await db.rpc(service, 'pipeline_add_member', { p_slug: slug, p_user_id: u.id, p_role: 'owner' });
  return u.id as string;
}

export function loadConfig(slug: string) {
  return JSON.parse(readFileSync(path.join(ROOT, 'tenants', slug, 'business.json'), 'utf8'));
}

export async function publish(db: TestDb, config: any) {
  return db.rpc(service, 'pipeline_publish_tenant', { p_config: config });
}

/** A local date (YYYY-MM-DD) `days` ahead that falls on the given ISO weekday. */
export function nextWeekday(isoWeekday: number, minDaysAhead = 2): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (((d.getUTCDay() + 6) % 7) + 1 !== isoWeekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
