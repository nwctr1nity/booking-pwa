import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { Switch } from '@astryxdesign/core/Switch';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus } from '@phosphor-icons/react';
import { formatPrice } from '@/lib/money';
import { fmtDuration } from '@/lib/time';
import type { SettingsService } from '@/lib/types';
import { useOwnerTenant } from '../OwnerContext';
import { Sheet } from '../Sheet';
import type { SectionProps } from './SettingsView';
import { useSave } from './useSave';

type Draft = Omit<SettingsService, 'id' | 'sort'> & { id?: string; sort?: number };

const EMPTY: Draft = { name: '', description: '', category: '', price_cents: 0, price_is_from: false, duration_minutes: 60, buffer_minutes: 0, is_active: true, resource_ids: [] };

export function ServicesSection({ settings }: SectionProps) {
  const tenant = useOwnerTenant();
  const [editing, setEditing] = useState<Draft | null>(null);
  return (
    <VStack gap={3}>
      <Text color="secondary">Цена и длительность новых записей берутся отсюда. Уже сделанные записи сохраняют цену на момент записи.</Text>
      <List hasDividers>
        {settings.services.map((s) => (
          <ListItem
            key={s.id}
            label={s.name}
            description={`${formatPrice(s.price_cents, s.price_is_from, tenant.currency)} · ${fmtDuration(s.duration_minutes)}${s.buffer_minutes ? ` + ${s.buffer_minutes} мин` : ''}`}
            onClick={() => setEditing(s)}
            endContent={s.is_active ? undefined : <Token size="sm" color="gray" label="Скрыта" />}
          />
        ))}
      </List>
      <Button icon={<Plus size={16} />} label="Добавить услугу" onClick={() => setEditing({ ...EMPTY, resource_ids: settings.resources.filter((r) => r.is_active).map((r) => r.id) })} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? 'Услуга' : 'Новая услуга'}>
        {editing ? <ServiceForm key={editing.id ?? 'new'} initial={editing} settings={settings} onDone={() => setEditing(null)} /> : null}
      </Sheet>
    </VStack>
  );
}

function ServiceForm({ initial, settings, onDone }: { initial: Draft; settings: SectionProps['settings']; onDone: () => void }) {
  const [d, setD] = useState<Draft>(initial);
  const [rub, setRub] = useState<number>(initial.price_cents / 100);
  const save = useSave('owner_save_service', (x: Draft) => ({ p_service: x }));
  const set = (patch: Partial<Draft>) => setD({ ...d, ...patch });
  const valid = d.name.trim().length >= 2 && d.duration_minutes >= 15 && d.resource_ids.length > 0 && rub >= 0;

  return (
    <VStack gap={4}>
      <TextInput label="Название" value={d.name} onChange={(v) => set({ name: v })} isRequired width="100%" />
      <TextArea label="Описание" value={d.description} onChange={(v) => set({ description: v })} rows={2} isOptional width="100%" />
      <TextInput label="Категория" value={d.category} onChange={(v) => set({ category: v })} isOptional placeholder="Мойка, Защита…" width="100%" />
      <HStack gap={2} wrap="wrap">
        <NumberInput label="Цена" units="₽" value={rub} onChange={(v) => setRub(v)} min={0} isIntegerOnly />
        <Switch label="Цена «от»" value={d.price_is_from} onChange={(v) => set({ price_is_from: v })} />
      </HStack>
      <HStack gap={2} wrap="wrap">
        <NumberInput label="Длительность" units="мин" value={d.duration_minutes} onChange={(v) => set({ duration_minutes: v })} min={15} max={20160} step={15} isIntegerOnly description="Многодневные работы: 1 день = 1440" />
        <NumberInput label="Пауза после" units="мин" value={d.buffer_minutes} onChange={(v) => set({ buffer_minutes: v })} min={0} max={480} step={5} isIntegerOnly />
      </HStack>
      <VStack gap={2}>
        <Text weight="semibold">Посты, где выполняется</Text>
        {settings.resources.map((r) => (
          <Switch
            key={r.id}
            label={r.is_active ? r.name : `${r.name} (выключен)`}
            value={d.resource_ids.includes(r.id)}
            onChange={(on) => set({ resource_ids: on ? [...d.resource_ids, r.id] : d.resource_ids.filter((x) => x !== r.id) })}
          />
        ))}
        {d.resource_ids.length === 0 ? <Text type="supporting">Выберите хотя бы один пост.</Text> : null}
      </VStack>
      <Switch label="Показывать клиентам" value={d.is_active} onChange={(v) => set({ is_active: v })} />
      <Button
        variant="primary"
        label="Сохранить"
        isDisabled={!valid}
        isLoading={save.isPending}
        onClick={() => save.mutate({ ...d, name: d.name.trim(), price_cents: Math.round(rub * 100) }, { onSuccess: onDone })}
      />
    </VStack>
  );
}
