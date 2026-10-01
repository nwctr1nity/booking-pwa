import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';

// Only the public anon key lives in the site. Everything sensitive is checked
// in SQL (RLS + membership) on the server.
export const supabase = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'studio-owner-auth' },
});
