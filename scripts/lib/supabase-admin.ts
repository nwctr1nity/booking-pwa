// Server-side access with the service-role key. Used ONLY by pipeline
// scripts run by the operator; the key never goes into the site build.
import { requireEnv } from './env.ts';

export class AdminApi {
  readonly url: string;
  private readonly key: string;
  constructor(url = requireEnv('SUPABASE_URL'), key = requireEnv('SUPABASE_SERVICE_ROLE_KEY')) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }

  private headers(extra: Record<string, string> = {}) {
    return { apikey: this.key, authorization: `Bearer ${this.key}`, ...extra };
  }

  async rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await fetch(`${this.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: this.headers({ 'content-type': 'application/json' }), body: JSON.stringify(args) });
    const text = await r.text();
    const body = text ? JSON.parse(text) : null;
    if (!r.ok) throw new Error(`${fn}: HTTP ${r.status} ${body?.message ?? text}`);
    if (body && typeof body === 'object' && 'error' in body) throw new Error(`${fn}: ${body.error}`);
    return body as T;
  }

  async upload(bucket: string, objectPath: string, bytes: Buffer, contentType: string) {
    const r = await fetch(`${this.url}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`, {
      method: 'POST',
      headers: this.headers({ 'content-type': contentType, 'x-upsert': 'true', 'cache-control': 'max-age=300' }),
      body: new Uint8Array(bytes),
    });
    if (!r.ok) throw new Error(`upload ${objectPath}: HTTP ${r.status} ${await r.text()}`);
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string } | null> {
    for (let page = 1; page < 50; page++) {
      const r = await fetch(`${this.url}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: this.headers() });
      if (!r.ok) throw new Error(`list users: HTTP ${r.status} ${await r.text()}`);
      const body = (await r.json()) as { users: { id: string; email: string }[] };
      const hit = body.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (hit) return hit;
      if (body.users.length < 200) return null;
    }
    return null;
  }

  /** Creates a confirmed email+password user (public sign-up stays disabled). */
  async createUser(email: string, password: string) {
    const r = await fetch(`${this.url}/auth/v1/admin/users`, {
      method: 'POST',
      headers: this.headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    if (!r.ok) throw new Error(`create user ${email}: HTTP ${r.status} ${await r.text()}`);
    return (await r.json()) as { id: string; email: string };
  }
}
