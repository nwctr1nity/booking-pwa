import { createContext, use } from 'react';
import type { Studio } from '@/lib/types';

export const StudioContext = createContext<Studio | null>(null);

export function useStudio(): Studio {
  const s = use(StudioContext);
  if (!s) throw new Error('useStudio outside StudioLayout');
  return s;
}
