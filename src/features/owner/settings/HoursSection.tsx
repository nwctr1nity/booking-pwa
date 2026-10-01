import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { Plus, Trash } from '@phosphor-icons/react';
import { WEEKDAYS, isoTime } from '@/lib/time';
import type { HoursRow } from '@/lib/types';
import type { SectionProps } from './SettingsView';
import { useSave } from './useSave';

const hm = (t: string) => t.slice(0, 5);

export function HoursSection({ settings }: SectionProps) {
  const [rows, setRows] = useState<HoursRow[]>(settings.hours.map((h) => ({ ...h, opens: hm(h.opens), closes: hm(h.closes) })));
  const save = useSave('owner_save_hours', (h: HoursRow[]) => ({ p_hours: h }), 'Часы работы сохранены');

  const invalid = rows.some((r) => !r.opens || !r.closes || r.opens >= r.closes);
  const update = (idx: number, patch: Partial<HoursRow>) => setRows(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  return (
    <VStack gap={3}>
      <Text color="secondary">Время, когда студия принимает машины. Запись на работу дольше интервала начинается в нём и продолжается дальше.</Text>
      {WEEKDAYS.map((wd, i) => {
        const weekday = i + 1;
        const list = rows.map((r, idx) => ({ r, idx })).filter((x) => x.r.weekday === weekday);
        return (
          <Card key={wd} padding={3}>
            <VStack gap={2}>
              <HStack justify="between" vAlign="center">
                <Text weight="semibold">{wd}</Text>
                {list.length === 0 ? <Text type="supporting">выходной</Text> : null}
              </HStack>
              {list.map(({ r, idx }) => (
                <HStack key={idx} gap={2} vAlign="end">
                  <TimeInput label="с" value={isoTime(r.opens)} onChange={(v) => update(idx, { opens: v ? hm(v) : '' })} hourFormat="24h" increment={15} />
                  <TimeInput label="до" value={isoTime(r.closes)} onChange={(v) => update(idx, { closes: v ? hm(v) : '' })} hourFormat="24h" increment={15} />
                  <IconButton variant="ghost" label="Убрать интервал" icon={<Trash size={18} />} onClick={() => setRows(rows.filter((_, j) => j !== idx))} />
                </HStack>
              ))}
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                label={list.length ? 'Ещё интервал' : 'Рабочий день'}
                onClick={() => setRows([...rows, { weekday, opens: list.length ? '14:00' : '10:00', closes: list.length ? '19:00' : '20:00' }])}
              />
            </VStack>
          </Card>
        );
      })}
      {invalid ? <Text color="secondary">Время окончания должно быть позже начала.</Text> : null}
      <Button variant="primary" label="Сохранить часы" isDisabled={invalid} isLoading={save.isPending} onClick={() => save.mutate(rows)} />
    </VStack>
  );
}
