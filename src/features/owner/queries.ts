import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@/lib/api';
import type { OwnerBookings, OwnerSettings, OwnerStats, OwnerTenant } from '@/lib/types';

export const ownerKeys = {
  tenants: ['owner', 'tenants'] as const,
  bookings: (tenant: string, from: string, to: string) => ['owner', tenant, 'bookings', from, to] as const,
  stats: (tenant: string, from: string, to: string) => ['owner', tenant, 'stats', from, to] as const,
  settings: (tenant: string) => ['owner', tenant, 'settings'] as const,
};

export function useMyTenants(enabled: boolean) {
  return useQuery({ queryKey: ownerKeys.tenants, queryFn: () => rpc<OwnerTenant[]>('owner_my_tenants'), enabled, staleTime: 300_000 });
}

export function useOwnerBookings(tenant: string, from: string, to: string) {
  return useQuery({
    queryKey: ownerKeys.bookings(tenant, from, to),
    queryFn: () => rpc<OwnerBookings>('owner_get_bookings', { p_tenant: tenant, p_from: from, p_to: to }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  });
}

export function useOwnerStats(tenant: string, from: string, to: string) {
  return useQuery({
    queryKey: ownerKeys.stats(tenant, from, to),
    queryFn: () => rpc<OwnerStats>('owner_get_stats', { p_tenant: tenant, p_from: from, p_to: to }),
    placeholderData: keepPreviousData,
  });
}

export function useOwnerSettings(tenant: string) {
  return useQuery({
    queryKey: ownerKeys.settings(tenant),
    queryFn: () => rpc<OwnerSettings>('owner_get_settings', { p_tenant: tenant }),
  });
}

/** Any change to bookings refreshes lists, stats and the public slot grid. */
export function useBookingMutation<TVars, TRes = unknown>(tenant: string, fn: (vars: TVars) => Promise<TRes>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['owner', tenant, 'bookings'] });
      void qc.invalidateQueries({ queryKey: ['owner', tenant, 'stats'] });
      void qc.invalidateQueries({ queryKey: ['public', 'slots'] });
    },
  });
}

/** Settings RPCs return the full settings object; also refresh the public studio. */
export function useSettingsMutation<TVars>(tenant: string, slug: string, fn: (vars: TVars) => Promise<OwnerSettings | unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      if (data && typeof data === 'object' && 'tenant' in data) qc.setQueryData(ownerKeys.settings(tenant), data);
      else void qc.invalidateQueries({ queryKey: ownerKeys.settings(tenant) });
      void qc.invalidateQueries({ queryKey: ['public', 'studio', slug] });
      void qc.invalidateQueries({ queryKey: ['public', 'slots', slug] });
    },
  });
}
