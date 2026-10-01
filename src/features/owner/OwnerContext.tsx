import { createContext, use } from 'react';
import type { OwnerTenant } from '@/lib/types';

export const OwnerTenantContext = createContext<OwnerTenant | null>(null);

export function useOwnerTenant() {
  const t = use(OwnerTenantContext);
  if (!t) throw new Error('useOwnerTenant outside OwnerApp');
  return t;
}
