import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { VStack } from '@astryxdesign/core/VStack';
import type { InfoCard } from '@/lib/types';
import type { SectionProps } from './SettingsView';
import { useSave } from './useSave';

const ICONS = [
  { value: 'shield', label: 'Щит (гарантия)' },
  { value: 'sparkle', label: 'Блеск (качество)' },
  { value: 'star', label: 'Звезда (отзывы)' },
  { value: 'clock', label: 'Часы (сроки)' },
];

export function InfoCardsSection({ settings }: SectionProps) {
  const initial: InfoCard[] = [0, 1, 2].map((i) => settings.tenant.info_cards[i] ?? { icon: 'sparkle', title: '', text: '' });
  const [cards, setCards] = useState(initial);
  const save = useSave('owner_update_profile', (list: InfoCard[]) => ({ p_patch: { info_cards: list } }));
  const set = (i: number, patch: Partial<InfoCard>) => setCards(cards.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const filled = cards.filter((c) => c.title.trim());
  const invalid = cards.some((c) => c.title.length > 40 || c.text.length > 160 || (!c.title.trim() && c.text.trim()));

  return (
    <VStack gap={4}>
      <Text color="secondary">До трёх карточек под главным фото. Пустая карточка не показывается.</Text>
      {cards.map((c, i) => (
        <Card key={i} padding={4}>
          <VStack gap={3}>
            <Text weight="semibold">Карточка {i + 1}</Text>
            <Selector label="Значок" value={c.icon ?? 'sparkle'} onChange={(v) => set(i, { icon: v ?? 'sparkle' })} options={ICONS} width="100%" />
            <TextInput label="Заголовок" value={c.title} onChange={(v) => set(i, { title: v })} placeholder="Гарантия 12 месяцев" width="100%" status={c.title.length > 40 ? { type: 'error', message: 'До 40 символов' } : undefined} />
            <TextInput label="Текст" value={c.text} onChange={(v) => set(i, { text: v })} width="100%" status={c.text.length > 160 ? { type: 'error', message: 'До 160 символов' } : undefined} />
          </VStack>
        </Card>
      ))}
      <Button
        variant="primary"
        label="Сохранить карточки"
        isDisabled={invalid}
        isLoading={save.isPending}
        onClick={() => save.mutate(filled.map((c) => ({ icon: c.icon, title: c.title.trim(), text: c.text.trim() })))}
      />
    </VStack>
  );
}
