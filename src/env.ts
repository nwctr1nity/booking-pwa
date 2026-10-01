import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20),
  VITE_VAPID_PUBLIC_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(import.meta.env);
if (!parsed.success) {
  throw new Error(`Не заданы переменные окружения сайта: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/$/, ''),
  supabaseAnonKey: parsed.data.VITE_SUPABASE_ANON_KEY,
  vapidPublicKey: parsed.data.VITE_VAPID_PUBLIC_KEY,
};
