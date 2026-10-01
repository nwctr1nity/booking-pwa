import { supabase } from '@/lib/supabase';
import { ApiError } from '@/lib/errors';
import { MEDIA_BUCKET } from '@/lib/media';

const MAX_SIDE = 2400;
const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/** Downscale big photos in the browser so phone camera shots fit the 8 MB bucket limit. */
async function prepare(file: File): Promise<Blob> {
  if (!TYPES.includes(file.type)) throw new ApiError('upload_type');
  if (file.size <= 1.5 * 1024 * 1024 || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/**
 * Uploads into <tenant>/owner/… — the only folder storage RLS lets a
 * member write. Pipeline files live in <tenant>/config/ and are never touched.
 */
export async function uploadOwnerImage(tenantId: string, file: File): Promise<string> {
  const body = await prepare(file);
  if (body.size > MAX_BYTES) throw new ApiError('upload_too_big');
  const ext = body.type === 'image/png' ? 'png' : body.type === 'image/webp' ? 'webp' : body.type === 'image/avif' ? 'avif' : 'jpg';
  const path = `${tenantId}/owner/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, body, { contentType: body.type || 'image/jpeg', upsert: false, cacheControl: '31536000' });
  if (error) throw new ApiError('upload_failed', error.message);
  return path;
}
