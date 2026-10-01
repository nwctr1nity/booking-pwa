// pnpm supabase:deploy [--dry-run] [--skip-function] [--site https://….vercel.app]
// Sets up the hosted Supabase project in one go, through the Management API
// (no database password, no Docker):
//   1. applies supabase/migrations/*.sql that are not applied yet, recording
//      them in supabase_migrations.schema_migrations like `supabase db push`
//   2. turns off public sign-up (owners are created by tenant:publish)
//   3. Web Push: generates VAPID keys once (public key → .env.production,
//      private key → function secret), a fresh cron secret → function secret
//      + Vault (notify_dispatch_url / notify_dispatch_secret)
//   4. deploys the notify-dispatch Edge Function via the Supabase CLI
// Needs SUPABASE_ACCESS_TOKEN (a personal access token, supabase.com →
// Account → Access Tokens) in the environment or .env. The project is taken
// from VITE_SUPABASE_URL in .env.production. Never prints secrets.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from '../lib/args.ts';
import { getEnv, requireEnv } from '../lib/env.ts';
import { generateVapidKeys } from '../lib/vapid.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const API = 'https://api.supabase.com/v1';
const { flags } = parseArgs(process.argv.slice(2));
const dry = Boolean(flags['dry-run']);
const token = requireEnv('SUPABASE_ACCESS_TOKEN');

const prodEnvPath = path.join(ROOT, '.env.production');
const prodEnv = readFileSync(prodEnvPath, 'utf8');
const prodVar = (k: string) => new RegExp(`^${k}=(.*)$`, 'm').exec(prodEnv)?.[1]?.trim() ?? '';
const projectUrl = prodVar('VITE_SUPABASE_URL').replace(/\/$/, '');
const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co$/.exec(projectUrl)?.[1];
if (!ref) throw new Error(`VITE_SUPABASE_URL in .env.production is not a hosted project URL: ${projectUrl}`);

async function api<T = unknown>(method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${text.slice(0, 500)}`);
  return (text ? JSON.parse(text) : null) as T;
}

const sql = <T = Record<string, unknown>>(query: string) => api<T[]>('POST', `/projects/${ref}/database/query`, { query });
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

console.log(`Supabase project ${ref}${dry ? ' (dry run: nothing is changed)' : ''}`);

// ---- 1. migrations ----------------------------------------------------------
await sql(`create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)`);
const applied = new Set((await sql<{ version: string }>('select version from supabase_migrations.schema_migrations')).map((r) => r.version));
const dir = path.join(ROOT, 'supabase/migrations');
for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const [version, ...rest] = f.replace(/\.sql$/, '').split('_');
  if (applied.has(version!)) continue;
  console.log(`  migration ${f}`);
  if (dry) continue;
  const body = readFileSync(path.join(dir, f), 'utf8');
  // one request = one transaction: a failing migration leaves nothing behind
  await sql(`begin;\n${body}\n;insert into supabase_migrations.schema_migrations(version, name, statements) values (${lit(version!)}, ${lit(rest.join('_'))}, array[]::text[]);\ncommit;`);
}
console.log(`Migrations: ${applied.size} already applied, database is up to date.`);

// ---- 2. auth ---------------------------------------------------------------
const site = (flags.site as string | undefined) ?? getEnv('SITE_URL');
if (!dry) {
  await api('PATCH', `/projects/${ref}/config/auth`, { disable_signup: true, ...(site ? { site_url: site } : {}) });
}
console.log(`Auth: public sign-up disabled${site ? `, site URL ${site}` : ''}.`);

// ---- 3. push secrets ---------------------------------------------------------
const secrets: { name: string; value: string }[] = [];
let vapidPublic = prodVar('VITE_VAPID_PUBLIC_KEY');
if (!vapidPublic || flags['rotate-push']) {
  const k = await generateVapidKeys();
  vapidPublic = k.publicKey;
  secrets.push({ name: 'VAPID_PUBLIC_KEY', value: k.publicKey }, { name: 'VAPID_PRIVATE_KEY', value: k.privateKey });
  if (!dry) writeFileSync(prodEnvPath, prodEnv.replace(/^VITE_VAPID_PUBLIC_KEY=.*$/m, `VITE_VAPID_PUBLIC_KEY=${k.publicKey}`));
  console.log('Push: new VAPID keys; public key written to .env.production (commit and push it so the site is rebuilt).');
}
const cronSecret = randomBytes(24).toString('hex');
secrets.push(
  { name: 'VAPID_SUBJECT', value: getEnv('VAPID_SUBJECT') ?? 'mailto:owner@example.com' },
  { name: 'NOTIFY_CRON_SECRET', value: cronSecret },
);
const fnUrl = `${projectUrl}/functions/v1/notify-dispatch`;
if (!dry) {
  await api('POST', `/projects/${ref}/secrets`, secrets);
  await sql(`do $$
    declare v_id uuid;
    begin
      select id into v_id from vault.secrets where name = 'notify_dispatch_url';
      if v_id is null then perform vault.create_secret(${lit(fnUrl)}, 'notify_dispatch_url');
      else perform vault.update_secret(v_id, ${lit(fnUrl)}); end if;
      select id into v_id from vault.secrets where name = 'notify_dispatch_secret';
      if v_id is null then perform vault.create_secret(${lit(cronSecret)}, 'notify_dispatch_secret');
      else perform vault.update_secret(v_id, ${lit(cronSecret)}); end if;
    end $$`);
}
console.log(`Function secrets set: ${secrets.map((s) => s.name).join(', ')}; Vault: notify_dispatch_url, notify_dispatch_secret.`);

// ---- 4. edge function ------------------------------------------------------
if (!flags['skip-function'] && !dry) {
  const r = spawnSync('npx', ['--yes', 'supabase@2', 'functions', 'deploy', 'notify-dispatch', '--project-ref', ref, '--use-api', '--no-verify-jwt'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: token },
  });
  if (r.status !== 0) throw new Error('functions deploy failed');
}

// ---- report ----------------------------------------------------------------
if (!dry) {
  const jobs = await sql<{ jobname: string }>(`select jobname from cron.job order by jobname`).catch(() => []);
  console.log(`Cron jobs: ${jobs.map((j) => j.jobname).join(', ') || 'none (enable pg_cron and pg_net in Database → Extensions, then rerun)'}`);
}
console.log('\nNext: pnpm tenant:publish <slug> --demo (needs SUPABASE_SECRET_KEY), then deploy the site and pnpm tenant:verify.');
