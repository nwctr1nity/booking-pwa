import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { ApiError } from '@/lib/errors';
import { queryClient } from '@/app/queryClient';

export function useSession() {
  const [state, setState] = useState<{ session: Session | null; loading: boolean }>({ session: null, loading: true });
  useEffect(() => {
    let alive = true;
    supabase.auth.getSession().then(({ data }) => alive && setState({ session: data.session, loading: false }));
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) queryClient.removeQueries({ queryKey: ['owner'] });
      setState({ session, loading: false });
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);
  return state;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  if (error) {
    if (/invalid/i.test(error.message) || error.status === 400) throw new ApiError('invalid_credentials');
    if (error.status === 429) throw new ApiError('rate_limited');
    throw new ApiError('network');
  }
}

/** Signs out and drops every cached owner response from memory. */
export async function signOut() {
  try {
    await supabase.auth.signOut();
  } finally {
    queryClient.clear();
  }
}
