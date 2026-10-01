import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { SectionProps } from './SettingsView';
import { ImagePicker } from './ImagePicker';
import { useSave } from './useSave';

const FIELDS = ['name', 'short_name', 'tagline', 'description', 'address', 'address_note', 'map_url', 'phone'] as const;
type Field = (typeof FIELDS)[number];

export function ProfileSection({ settings }: SectionProps) {
  const t = settings.tenant;
  const initial = Object.fromEntries(FIELDS.map((f) => [f, (t[f] as string | null) ?? ''])) as Record<Field, string>;
  const [v, setV] = useState(initial);
  const [cancelHours, setCancelHours] = useState<number>(t.cancellation_hours);
  const save = useSave('owner_update_profile', (patch: Record<string, unknown>) => ({ p_patch: patch }));

  const changed: Record<string, unknown> = {};
  for (const f of FIELDS) if (v[f] !== initial[f]) changed[f] = v[f];
  if (cancelHours !== t.cancellation_hours) changed.cancellation_hours = cancelHours;
  const dirty = Object.keys(changed).length > 0;
  const set = (f: Field) => (x: string) => setV({ ...v, [f]: x });

  return (
    <VStack gap={4}>
      <Card padding={4}>
        <VStack gap={4}>
          <TextInput label="Название" value={v.name} onChange={set('name')} isRequired width="100%" />
          <TextInput label="Короткое название" description="Под иконкой на телефоне" value={v.short_name} onChange={set('short_name')} width="100%" />
          <TextInput label="Слоган" value={v.tagline} onChange={set('tagline')} isOptional width="100%" />
          <TextArea label="Описание" value={v.description} onChange={set('description')} rows={3} maxLength={400} width="100%" />
          <TextInput label="Адрес" value={v.address} onChange={set('address')} width="100%" />
          <TextInput label="Как проехать" value={v.address_note} onChange={set('address_note')} isOptional width="100%" />
          <TextInput label="Ссылка на карту" value={v.map_url} onChange={set('map_url')} isOptional placeholder="https://yandex.ru/maps/…" width="100%" />
          <TextInput label="Телефон" value={v.phone} onChange={set('phone')} width="100%" />
          <NumberInput label="Онлайн-отмена не позже чем за, ч" value={cancelHours} onChange={(n) => setCancelHours(n)} min={0} max={168} isIntegerOnly width="100%" />
          <Button variant="primary" label="Сохранить" isDisabled={!dirty} isLoading={save.isPending} onClick={() => save.mutate(changed)} />
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={5}>
          <ImagePicker label="Логотип" hint="Квадрат от 512×512" path={t.logo_path} onUploaded={(p) => save.mutateAsync({ logo_path: p })} />
          <ImagePicker label="Главное фото" hint="Горизонтальное, от 1200×700" path={t.hero_path} wide onUploaded={(p) => save.mutateAsync({ hero_path: p })} />
        </VStack>
      </Card>
    </VStack>
  );
}
