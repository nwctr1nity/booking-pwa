import { createClient } from '@supabase/supabase-js';
import { env } from '@/env';
import { setAccessTokenProvider } from './api';

// Only the public anon key lives in the site. Everything sensitive is checked
// in SQL (RLS + membership) on the server.
export const supabase = createClient(env.supabaseUrl, env.supabaseKey, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'studio-owner-auth' },
});

// Owner RPCs go out with the signed-in user's JWT (refreshed by supabase-js).
setAccessTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token);
