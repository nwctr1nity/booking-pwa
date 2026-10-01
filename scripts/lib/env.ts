// Reads settings for scripts: real environment first, then .env.local, then .env.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
let fileVars: Record<string, string> | null = null;

function loadFiles() {
  if (fileVars) return fileVars;
  fileVars = {};
  for (const f of ['.env', '.env.local']) {
    const p = path.join(ROOT, f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) fileVars[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
  return fileVars;
}

export function getEnv(name: string): string | undefined {
  // SUPABASE_SERVICE_ROLE_KEY (legacy JWT) is accepted for SUPABASE_SECRET_KEY.
  if (name === 'SUPABASE_SECRET_KEY') return process.env[name] ?? loadFiles()[name] ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? loadFiles().SUPABASE_SERVICE_ROLE_KEY;
  return process.env[name] ?? loadFiles()[name];
}

export function requireEnv(name: string): string {
  const v = getEnv(name);
  if (!v) {
    console.error(`Не задана переменная ${name} (в окружении или .env.local). См. SETUP.md.`);
    process.exit(2);
  }
  return v;
}

/**
 * The public settings the site build uses, resolved exactly like Vite does
 * for `vite build` (.env < .env.local < .env.production < .env.production.local
 * < real environment). Used by the shell generator and tenant:verify so they
 * talk to the same Supabase project the built site talks to.
 */
export async function siteEnv() {
  const { loadEnv } = await import('vite');
  const e = { ...loadEnv('production', ROOT, 'VITE_') };
  const url = e.VITE_SUPABASE_URL?.replace(/\/$/, '');
  const key = e.VITE_SUPABASE_PUBLISHABLE_KEY || e.VITE_SUPABASE_ANON_KEY;
  return { url, key, vapid: e.VITE_VAPID_PUBLIC_KEY };
}

/**
 * Headers for a call with a project key. New-style keys (sb_publishable_…,
 * sb_secret_…) are not JWTs and go only in `apikey`; legacy anon/service
 * JWT keys are also sent as the bearer token.
 */
export function keyHeaders(key: string, extra: Record<string, string> = {}) {
  return { apikey: key, ...(key.startsWith('eyJ') ? { authorization: `Bearer ${key}` } : {}), ...extra };
}
