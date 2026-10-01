// Runs the Edge Function locally with Deno (npm package `deno`), with the
// secrets from .env.local. The gateway proxies /functions/v1/* here.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.ts';

const env: Record<string, string> = { ...process.env } as Record<string, string>;
for (const line of readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]!] = m[2]!;
}
env.PORT = process.env.FUNCTIONS_PORT ?? '54330';
const deno = path.join(ROOT, 'node_modules/deno/deno');
const child = spawn(deno, ['run', '--allow-net', '--allow-env', '--no-prompt', 'supabase/functions/notify-dispatch/index.ts'], { cwd: ROOT, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => child.kill(s));
