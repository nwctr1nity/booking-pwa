import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import type { PublicBooking, SlotsResponse, Studio } from '@/lib/types';

// Public studio data (no personal data) is cached on the device so the
// studio page opens offline. Private owner data is never stored like this.
const studioCacheKey = (slug: string) => `studio:${slug}:public`;

function readCachedStudio(slug: string): Studio | undefined {
  try {
    const raw = localStorage.getItem(studioCacheKey(slug));
    return raw ? (JSON.parse(raw) as Studio) : undefined;
  } catch {
    return undefined;
  }
}

export const studioKeys = {
  studio: (slug: string) => ['public', 'studio', slug] as const,
  slots: (slug: string, serviceId: string, from: string, days: number) => ['public', 'slots', slug, serviceId, from, days] as const,
  booking: (slug: string, token: string) => ['public', 'booking', slug, token] as const,
};

export async function fetchStudio(slug: string) {
  const studio = await rpc<Studio>('public_get_studio', { p_slug: slug });
  try {
    localStorage.setItem(studioCacheKey(slug), JSON.stringify(studio));
  } catch {
    /* ignore quota */
  }
  return studio;
}

export function useStudioQuery(slug: string) {
  return useQuery({
    queryKey: studioKeys.studio(slug),
    queryFn: () => fetchStudio(slug),
    initialData: () => readCachedStudio(slug),
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  });
}

export function useSlotsQuery(slug: string, serviceId: string | null, from: string, days: number) {
  return useQuery({
    queryKey: studioKeys.slots(slug, serviceId ?? '', from, days),
    queryFn: () => rpc<SlotsResponse>('public_get_slots', { p_slug: slug, p_service_id: serviceId, p_from: from, p_days: days }),
    enabled: !!serviceId,
    staleTime: 15_000,
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useBookingQuery(slug: string, token: string | null) {
  return useQuery({
    queryKey: studioKeys.booking(slug, token ?? ''),
    queryFn: () => rpc<PublicBooking>('public_get_booking', { p_slug: slug, p_token: token }),
    enabled: !!token,
    staleTime: 10_000,
    retry: (count, err) => count < 2 && !(err instanceof Error && err.message === 'booking_not_found'),
  });
}
