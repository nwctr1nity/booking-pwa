import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/errors';

const NO_RETRY = new Set(['tenant_not_found', 'booking_not_found', 'forbidden', 'rate_limited', 'invalid_input', 'not_found']);

// In-memory only. Private (owner) data is never persisted to storage and the
// whole cache is cleared on logout.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => count < 2 && !(err instanceof ApiError && NO_RETRY.has(err.code)),
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
