import { useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { DateInput } from '@astryxdesign/core/DateInput';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Switch } from '@astryxdesign/core/Switch';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { fmtLocalDate, studioToday, isoDate, isoTime } from '@/lib/time';
import type { SectionProps } from './SettingsView';
import { useSave } from './useSave';

export function ExceptionsSection({ settings }: SectionProps) {
  const today = studioToday(settings.tenant.timezone);
  const [day, setDay] = useState(today);
  const [closed, setClosed] = useState(true);
  const [opens, setOpens] = useState('10:00');
  const [closes, setCloses] = useState('16:00');
  const [note, setNote] = useState('');
  const save = useSave('owner_save_exception', (x: Record<string, unknown>) => ({ p_exception: x }));
  const del = useSave('owner_delete_exception', (d: string) => ({ p_day: d }), 'Особый день удалён');

  return (
    <VStack gap={4}>
      {settings.exceptions.length === 0 ? (
        <EmptyState isCompact title="Особых дней нет" description="Добавьте праздники или сокращённые дни." />
      ) : (
        <List hasDividers>
          {settings.exceptions.map((e) => (
            <ListItem
              key={e.day}
              label={fmtLocalDate(e.day, 'd MMMM yyyy, EEEEEE')}
              description={`${e.is_closed ? 'Не работаем' : `${e.opens}–${e.closes}`}${e.note ? ` · ${e.note}` : ''}`}
              endContent={<Button size="sm" variant="ghost" label="Удалить" isLoading={del.isPending && del.variables === e.day} onClick={() => del.mutate(e.day)} />}
            />
          ))}
        </List>
      )}
      <Card padding={4}>
        <VStack gap={3}>
          <DateInput label="Дата" value={isoDate(day)} min={isoDate(today)} onChange={(v) => v && setDay(v)} weekStartsOn="mon" />
          <Switch label="Студия закрыта весь день" value={closed} onChange={setClosed} />
          {!closed ? (
            <HStack gap={2}>
              <TimeInput label="с" value={isoTime(opens)} onChange={(v) => v && setOpens(v.slice(0, 5))} hourFormat="24h" increment={15} />
              <TimeInput label="до" value={isoTime(closes)} onChange={(v) => v && setCloses(v.slice(0, 5))} hourFormat="24h" increment={15} />
            </HStack>
          ) : null}
          <TextInput label="Заметка" value={note} onChange={setNote} isOptional placeholder="Праздник" width="100%" />
          <Button
            variant="primary"
            label="Сохранить день"
            isDisabled={!closed && opens >= closes}
            isLoading={save.isPending}
            onClick={() => save.mutate({ day, is_closed: closed, opens: closed ? null : opens, closes: closed ? null : closes, note }, { onSuccess: () => setNote('') })}
          />
        </VStack>
      </Card>
    </VStack>
  );
}
