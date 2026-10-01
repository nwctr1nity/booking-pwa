import { useState } from 'react';
import { FileInput } from '@astryxdesign/core/FileInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Text } from '@astryxdesign/core/Text';
import { useToast } from '@astryxdesign/core/Toast';
import { errorMessage } from '@/lib/errors';
import { mediaUrl } from '@/lib/media';
import { useOwnerTenant } from '../OwnerContext';
import { uploadOwnerImage } from './upload';

/** Shows the current photo and uploads a replacement; `onUploaded` stores the new path. */
export function ImagePicker({
  label,
  path,
  version,
  hint,
  wide,
  onUploaded,
}: {
  label: string;
  path: string | null;
  version?: string;
  hint?: string;
  wide?: boolean;
  onUploaded: (path: string) => Promise<unknown>;
}) {
  const tenant = useOwnerTenant();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const url = mediaUrl(path, version);
  return (
    <VStack gap={2}>
      {url ? <img className={wide ? 'media-frame media-frame--wide' : 'media-frame'} src={url} alt={label} style={wide ? undefined : { width: 96, height: 96, aspectRatio: '1' }} /> : <Text type="supporting">Фото не загружено</Text>}
      <FileInput
        label={label}
        description={hint}
        value={null}
        accept="image/jpeg,image/png,image/webp,image/avif"
        isLoading={busy}
        placeholder="Выбрать фото"
        onChange={async (f) => {
          const file = Array.isArray(f) ? f[0] : f;
          if (!file) return;
          setBusy(true);
          try {
            const p = await uploadOwnerImage(tenant.id, file);
            await onUploaded(p);
          } catch (e) {
            toast({ body: errorMessage(e), type: 'error' });
          } finally {
            setBusy(false);
          }
        }}
        width="100%"
      />
    </VStack>
  );
}
