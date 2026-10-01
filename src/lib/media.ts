import { env } from '@/env';

export const MEDIA_BUCKET = 'tenant-media';

export function mediaUrl(path: string | null | undefined, version?: string) {
  if (!path) return null;
  const v = version ? `?v=${encodeURIComponent(version)}` : '';
  return `${env.supabaseUrl}/storage/v1/object/public/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}${v}`;
}
