import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { FileInput } from '@astryxdesign/core/FileInput';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { ArrowDown, ArrowUp, Trash } from '@phosphor-icons/react';
import { errorMessage } from '@/lib/errors';
import { mediaUrl } from '@/lib/media';
import type { GalleryItem } from '@/lib/types';
import { useOwnerTenant } from '../OwnerContext';
import type { SectionProps } from './SettingsView';
import { uploadOwnerImage } from './upload';
import { useSave } from './useSave';

/**
 * Three separate actions, each touching exactly one card: add a new card,
 * replace the photo of one card, edit the caption of one card. Other cards
 * keep their photo, caption and position.
 */
export function GallerySection({ settings }: SectionProps) {
  const tenant = useOwnerTenant();
  const toast = useToast();
  const add = useSave('owner_gallery_add', (x: { path: string; caption: string }) => ({ p_image_path: x.path, p_caption: x.caption }), 'Карточка добавлена');
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <VStack gap={4}>
      {settings.gallery.length === 0 ? <Text color="secondary">Фото работ пока нет.</Text> : null}
      {settings.gallery.map((g, i) => (
        <GalleryCard key={g.id} g={g} first={i === 0} last={i === settings.gallery.length - 1} />
      ))}
      <Card padding={4}>
        <VStack gap={3}>
          <Text weight="semibold">Новая карточка</Text>
          <FileInput label="Фото" value={file} onChange={(f) => setFile(Array.isArray(f) ? (f[0] ?? null) : f)} accept="image/jpeg,image/png,image/webp,image/avif" placeholder="Выбрать фото" width="100%" />
          <TextInput label="Подпись" value={caption} onChange={setCaption} isOptional width="100%" />
          <Button
            variant="primary"
            label="Добавить карточку"
            isDisabled={!file || caption.length > 140}
            isLoading={busy}
            onClick={async () => {
              if (!file) return;
              setBusy(true);
              try {
                const path = await uploadOwnerImage(tenant.id, file);
                await add.mutateAsync({ path, caption: caption.trim() });
                setFile(null);
                setCaption('');
              } catch (e) {
                if (!add.isError) toast({ body: errorMessage(e), type: 'error' });
              } finally {
                setBusy(false);
              }
            }}
          />
        </VStack>
      </Card>
    </VStack>
  );
}

function GalleryCard({ g, first, last }: { g: GalleryItem; first: boolean; last: boolean }) {
  const tenant = useOwnerTenant();
  const toast = useToast();
  const [caption, setCaption] = useState(g.caption);
  const [uploading, setUploading] = useState(false);
  const replace = useSave('owner_gallery_replace', (path: string) => ({ p_item_id: g.id, p_image_path: path }), 'Фото заменено');
  const saveCaption = useSave('owner_gallery_caption', (c: string) => ({ p_item_id: g.id, p_caption: c }), 'Подпись сохранена');
  const del = useSave('owner_gallery_delete', () => ({ p_item_id: g.id }), 'Карточка удалена');
  const move = useSave('owner_gallery_move', (dir: number) => ({ p_item_id: g.id, p_direction: dir }), 'Порядок изменён');

  return (
    <Card padding={3}>
      <VStack gap={3}>
        <img className="media-frame" src={mediaUrl(g.image_path, g.updated_at) ?? ''} alt={g.caption || 'Фото работы'} loading="lazy" />
        <FileInput
          label="Заменить фото"
          value={null}
          isLoading={uploading}
          accept="image/jpeg,image/png,image/webp,image/avif"
          placeholder="Выбрать новое фото"
          onChange={async (f) => {
            const file = Array.isArray(f) ? f[0] : f;
            if (!file) return;
            setUploading(true);
            try {
              await replace.mutateAsync(await uploadOwnerImage(tenant.id, file));
            } catch (e) {
              if (!replace.isError) toast({ body: errorMessage(e), type: 'error' });
            } finally {
              setUploading(false);
            }
          }}
          width="100%"
        />
        <HStack gap={2} vAlign="end">
          <TextInput label="Подпись" value={caption} onChange={setCaption} width="100%" status={caption.length > 140 ? { type: 'error', message: 'До 140 символов' } : undefined} />
          <Button label="Сохранить" isDisabled={caption === g.caption || caption.length > 140} isLoading={saveCaption.isPending} onClick={() => saveCaption.mutate(caption.trim())} />
        </HStack>
        <HStack gap={1} justify="end">
          <IconButton variant="ghost" label="Выше" icon={<ArrowUp size={18} />} isDisabled={first} onClick={() => move.mutate(-1)} />
          <IconButton variant="ghost" label="Ниже" icon={<ArrowDown size={18} />} isDisabled={last} onClick={() => move.mutate(1)} />
          <IconButton variant="ghost" label="Удалить карточку" icon={<Trash size={18} />} isLoading={del.isPending} onClick={() => del.mutate(undefined)} />
        </HStack>
      </VStack>
    </Card>
  );
}
