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
