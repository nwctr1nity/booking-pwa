import { z } from 'zod';

const schema = z.object({
  VITE_SUPABASE_URL: z.url(),
  // Publishable key (sb_publishable_…) or a legacy anon JWT; both are public.
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  VITE_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  VITE_VAPID_PUBLIC_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(import.meta.env);
if (!parsed.success || !(parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY || parsed.data.VITE_SUPABASE_ANON_KEY)) {
  throw new Error(`Не заданы переменные окружения сайта: ${parsed.success ? 'VITE_SUPABASE_PUBLISHABLE_KEY' : parsed.error.issues.map((i) => i.path.join('.')).join(', ')}`);
}

export const env = {
  supabaseUrl: parsed.data.VITE_SUPABASE_URL.replace(/\/$/, ''),
  supabaseKey: (parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY || parsed.data.VITE_SUPABASE_ANON_KEY)!,
  vapidPublicKey: parsed.data.VITE_VAPID_PUBLIC_KEY,
};
