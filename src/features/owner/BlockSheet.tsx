import { useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { fmtDateTime, zonedToIso, isoDate, isoTime } from '@/lib/time';
import type { OwnerBlock } from '@/lib/types';
import { useOwnerTenant } from './OwnerContext';
import { useBookingMutation, useOwnerSettings } from './queries';
import { Sheet } from './Sheet';
import { useStudio } from '@/features/studio/StudioContext';
import { ownerWords } from '@/features/studio/words';

export function BlockSheet({ open, defaultDay, blocks, onClose }: { open: boolean; defaultDay: string; blocks: OwnerBlock[]; onClose: () => void }) {
  const w = ownerWords(useStudio().kind);
  return (
    <Sheet open={open} onClose={onClose} title={w.blockTitle} description={w.blockHint}>
      {open ? <BlockForm defaultDay={defaultDay} blocks={blocks} onClose={onClose} /> : null}
    </Sheet>
  );
}

function BlockForm({ defaultDay, blocks, onClose }: { defaultDay: string; blocks: OwnerBlock[]; onClose: () => void }) {
  const tenant = useOwnerTenant();
  const w = ownerWords(useStudio().kind);
  const toast = useToast();
  const settings = useOwnerSettings(tenant.id);
  const resources = (settings.data?.resources ?? []).filter((r) => r.is_active);
  const [resourceId, setResourceId] = useState('');
  const [fromDay, setFromDay] = useState(defaultDay);
  const [fromTime, setFromTime] = useState('10:00');
  const [toDay, setToDay] = useState(defaultDay);
  const [toTime, setToTime] = useState('12:00');
  const [note, setNote] = useState('');
  const rid = resourceId || resources[0]?.id || '';

  const block = useBookingMutation(tenant.id, () =>
    rpc('owner_block_resource', {
      p_tenant: tenant.id,
      p_resource_id: rid,
      p_from: zonedToIso(fromDay, fromTime.slice(0, 5), tenant.timezone),
      p_to: zonedToIso(toDay, toTime.slice(0, 5), tenant.timezone),
      p_note: note,
    }),
  );
  const unblock = useBookingMutation(tenant.id, (id: string) => rpc('owner_unblock_resource', { p_tenant: tenant.id, p_block_id: id }));

  return (
    <VStack gap={4}>
      <Selector label={w.resource} value={rid} onChange={(v) => setResourceId(v ?? '')} options={resources.map((r) => ({ value: r.id, label: r.name }))} isLoading={settings.isPending} width="100%" />
      <HStack gap={2} wrap="wrap">
        <DateInput label="С даты" value={isoDate(fromDay)} onChange={(v) => v && setFromDay(v)} weekStartsOn="mon" />
        <TimeInput label="с" value={isoTime(fromTime)} onChange={(v) => v && setFromTime(v)} hourFormat="24h" increment={15} />
      </HStack>
      <HStack gap={2} wrap="wrap">
        <DateInput label="По дату" value={isoDate(toDay)} onChange={(v) => v && setToDay(v)} weekStartsOn="mon" />
        <TimeInput label="до" value={isoTime(toTime)} onChange={(v) => v && setToTime(v)} hourFormat="24h" increment={15} />
      </HStack>
      <TextInput label="Причина" value={note} onChange={setNote} isOptional placeholder={w.hasCar ? 'Ремонт подъёмника' : 'Отпуск мастера'} width="100%" />
      {block.error ? <Banner status="error" title={block.error instanceof Error && block.error.message === 'slot_taken' ? `На это время у «${resources.find((r) => r.id === rid)?.name ?? w.resourceLower}» есть запись. Сначала перенесите её.` : errorMessage(block.error)} collapsible={false} /> : null}
      <Button
        variant="primary"
        label={w.blockTitle}
        isDisabled={!rid}
        isLoading={block.isPending}
        onClick={() => block.mutate(undefined, { onSuccess: () => { toast({ body: w.blocked }); onClose(); } })}
      />
      {blocks.length > 0 ? (
        <List hasDividers header={<Text weight="semibold">Закрыто в выбранном периоде</Text>}>
          {blocks.map((x) => (
            <ListItem
              key={x.id}
              label={`${x.resource_name}: ${fmtDateTime(x.starts_at, tenant.timezone)} – ${fmtDateTime(x.ends_at, tenant.timezone)}`}
              description={x.note || undefined}
              endContent={<Button size="sm" label="Открыть" isLoading={unblock.isPending && unblock.variables === x.id} onClick={() => unblock.mutate(x.id)} />}
            />
          ))}
        </List>
      ) : null}
    </VStack>
  );
}
