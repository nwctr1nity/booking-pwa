import { useToast } from '@astryxdesign/core/Toast';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { OwnerSettings } from '@/lib/types';
import { useStudio } from '@/features/studio/StudioContext';
import { useOwnerTenant } from '../OwnerContext';
import { useSettingsMutation } from '../queries';

/** Calls a settings RPC (which returns fresh settings) and reports the result in a toast. */
export function useSave<TVars>(fn: string, args: (vars: TVars, tenant: string) => Record<string, unknown>, success = 'Сохранено') {
  const tenant = useOwnerTenant();
  const studio = useStudio();
  const toast = useToast();
  return useSettingsMutation(tenant.id, studio.slug, async (vars: TVars) => {
    try {
      const res = await rpc<OwnerSettings>(fn, { p_tenant: tenant.id, ...args(vars, tenant.id) });
      toast({ body: success });
      return res;
    } catch (e) {
      toast({ body: errorMessage(e), type: 'error' });
      throw e;
    }
  });
}
