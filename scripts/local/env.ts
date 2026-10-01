// Settings of the local stack (PostgreSQL + API gateway). Local only.
import path from 'node:path';
import { SignJWT } from 'jose';

export const ROOT = path.resolve(import.meta.dirname, '../..');
export const LOCAL_DB_URL = process.env.LOCAL_DB_URL ?? 'postgres://postgres@127.0.0.1:54322/app_local';
export const ADMIN_DB_URL = LOCAL_DB_URL.replace(/\/[^/]*$/, '/postgres');
export const GATEWAY_PORT = Number(process.env.GATEWAY_PORT ?? 54321);
export const GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`;
export const FUNCTIONS_URL = process.env.LOCAL_FUNCTIONS_URL ?? 'http://127.0.0.1:54330';
// Not a secret: only signs tokens for the local gateway.
export const LOCAL_JWT_SECRET = process.env.LOCAL_JWT_SECRET ?? 'local-only-jwt-secret-not-for-production-use';
export const MEDIA_DIR = path.join(ROOT, '.local/storage');

const key = new TextEncoder().encode(LOCAL_JWT_SECRET);

export function signJwt(claims: Record<string, unknown>, expiresIn: string | number = '10y' /* number = seconds from now */) {
  return new SignJWT(claims).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuedAt().setIssuer('local-gateway').setExpirationTime(typeof expiresIn === 'number' ? `${expiresIn}s` : expiresIn).sign(key);
}

export const jwtKey = key;
export const anonKey = () => signJwt({ role: 'anon' });
export const serviceKey = () => signJwt({ role: 'service_role' });
// New-style Supabase API keys are opaque strings, not JWTs: the gateway maps
// them to a role, as Supabase's API gateway does.
export const PUBLISHABLE_KEY = 'sb_publishable_local_emulator_0000000000';
export const SECRET_KEY = 'sb_secret_local_emulator_00000000000000';
