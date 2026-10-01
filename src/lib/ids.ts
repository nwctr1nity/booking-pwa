/** Random request key for idempotent writes (matches ^[A-Za-z0-9_-]{16,100}$). */
export function newRequestKey() {
  return crypto.randomUUID().replace(/-/g, '');
}
