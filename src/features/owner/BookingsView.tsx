import { useMemo, useState } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { List, ListItem } from '@astryxdesign/core/List';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretLeft, CaretRight, Lock, Plus } from '@phosphor-icons/react';
import { QueryState } from '@/components/QueryState';
import { formatMoney } from '@/lib/money';
import { addLocalDays, fmtLocalDate, fmtTime, localDateOf, studioToday, weekRange } from '@/lib/time';
import type { OwnerBlock, OwnerBooking } from '@/lib/types';
import { useOwnerTenant } from './OwnerContext';
import { useOwnerBookings, useOwnerStats } from './queries';
import { STATUS_META } from './format';
import { BookingSheet } from './BookingSheet';
import { NewBookingSheet } from './NewBookingSheet';
import { BlockSheet } from './BlockSheet';
import { StatTiles } from './StatsView';

type Mode = 'day' | 'week';

export function BookingsView() {
  const tenant = useOwnerTenant();
  const tz = tenant.timezone;
  const today = studioToday(tz);
  const [mode, setMode] = useState<Mode>('day');
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [blocking, setBlocking] = useState(false);

  const { from, to } = mode === 'day' ? { from: date, to: date } : weekRange(date);
  const q = useOwnerBookings(tenant.id, from, to);
  const stats = useOwnerStats(tenant.id, from, to);
  const step = mode === 'day' ? 1 : 7;
  const label = mode === 'day' ? fmtLocalDate(date, 'EEEE, d MMMM') : `${fmtLocalDate(from, 'd MMM')} – ${fmtLocalDate(to, 'd MMM')}`;
  const booking = q.data?.bookings.find((b) => b.id === selected) ?? null;

  return (
    <VStack gap={4}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <SegmentedControl label="Период" value={mode} onChange={(v) => setMode(v as Mode)}>
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Неделя" />
        </SegmentedControl>
        <HStack gap={1} vAlign="center">
          <IconButton variant="ghost" label="Назад" icon={<CaretLeft size={18} />} onClick={() => setDate(addLocalDays(date, -step))} />
          <Button variant="ghost" size="sm" label="Сегодня" isDisabled={date === today} onClick={() => setDate(today)} />
          <IconButton variant="ghost" label="Вперёд" icon={<CaretRight size={18} />} onClick={() => setDate(addLocalDays(date, step))} />
        </HStack>
      </HStack>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Text weight="semibold" size="lg">
          {label}
        </Text>
        <HStack gap={2}>
          <Button size="sm" icon={<Lock size={16} />} label="Закрыть пост" onClick={() => setBlocking(true)} />
          <Button size="sm" variant="primary" icon={<Plus size={16} />} label="Запись" onClick={() => setCreating(true)} />
        </HStack>
      </HStack>

      {stats.data ? <StatTiles stats={stats.data} compact /> : null}

      <QueryState
        query={q}
        isEmpty={(d) => d.bookings.length === 0 && d.blocks.length === 0}
        empty={
          <EmptyState
            title={mode === 'day' ? 'На этот день записей нет' : 'На этой неделе записей нет'}
            description="Новые онлайн-записи появятся здесь автоматически."
            actions={<Button label="Добавить запись" onClick={() => setCreating(true)} />}
          />
        }
      >
        {(d) =>
          mode === 'day' ? (
            <DayList bookings={d.bookings} blocks={d.blocks} tz={tz} onOpen={setSelected} currency={tenant.currency} />
          ) : (
            <WeekList from={from} bookings={d.bookings} blocks={d.blocks} tz={tz} onOpen={setSelected} currency={tenant.currency} />
          )
        }
      </QueryState>

      <BookingSheet booking={booking} onClose={() => setSelected(null)} />
      <NewBookingSheet open={creating} defaultDay={date} onClose={() => setCreating(false)} onCreated={(id, day) => { setMode('day'); setDate(day); setSelected(id); }} />
      <BlockSheet open={blocking} defaultDay={date} blocks={q.data?.blocks ?? []} onClose={() => setBlocking(false)} />
    </VStack>
  );
}

function BookingRow({ b, tz, onOpen, currency }: { b: OwnerBooking; tz: string; onOpen: (id: string) => void; currency: string }) {
  const meta = STATUS_META[b.status];
  const multiDay = localDateOf(b.starts_at, tz) !== localDateOf(b.ends_at, tz);
  const net = b.paid_cents - b.refunded_cents;
  return (
    <ListItem
      label={`${fmtTime(b.starts_at, tz)}–${multiDay ? fmtLocalDate(localDateOf(b.ends_at, tz), 'd MMM') + ' ' : ''}${fmtTime(b.ends_at, tz)} · ${b.service_name}`}
      description={`${b.customer_name} · ${b.car} · ${b.resource_name}${net ? ` · оплачено ${formatMoney(net, currency)}` : ''}${b.is_demo ? ' · демо' : ''}`}
      onClick={() => onOpen(b.id)}
      endContent={<Token size="sm" label={meta.label} color={meta.color} />}
    />
  );
}

function BlockRow({ x, tz }: { x: OwnerBlock; tz: string }) {
  return (
    <ListItem
      label={`${fmtTime(x.starts_at, tz)}–${fmtTime(x.ends_at, tz)} · ${x.resource_name} закрыт`}
      description={x.note || 'Блокировка поста'}
      startContent={<Lock size={18} aria-hidden />}
    />
  );
}

function DayList({ bookings, blocks, tz, onOpen, currency }: { bookings: OwnerBooking[]; blocks: OwnerBlock[]; tz: string; onOpen: (id: string) => void; currency: string }) {
  const active = bookings.filter((b) => b.status !== 'cancelled');
  const cancelled = bookings.filter((b) => b.status === 'cancelled');
  return (
    <VStack gap={4}>
      <List hasDividers>
        {active.map((b) => (
          <BookingRow key={b.id} b={b} tz={tz} onOpen={onOpen} currency={currency} />
        ))}
        {blocks.map((x) => (
          <BlockRow key={x.id} x={x} tz={tz} />
        ))}
      </List>
      {cancelled.length > 0 ? (
        <List hasDividers header={<Text color="secondary">Отменённые</Text>}>
          {cancelled.map((b) => (
            <BookingRow key={b.id} b={b} tz={tz} onOpen={onOpen} currency={currency} />
          ))}
        </List>
      ) : null}
    </VStack>
  );
}

function WeekList({ from, bookings, blocks, tz, onOpen, currency }: { from: string; bookings: OwnerBooking[]; blocks: OwnerBlock[]; tz: string; onOpen: (id: string) => void; currency: string }) {
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addLocalDays(from, i)), [from]);
  return (
    <VStack gap={4}>
      {days.map((d) => {
        const list = bookings.filter((b) => {
          if (b.status === 'cancelled') return false;
          const start = localDateOf(b.starts_at, tz);
          // A multi-day job that began before this week is listed on its first day.
          return start === d || (d === from && start < from);
        });
        const bl = blocks.filter((x) => localDateOf(x.starts_at, tz) === d);
        return (
          <List
            key={d}
            hasDividers
            header={
              <HStack justify="between">
                <Text weight="semibold">{fmtLocalDate(d, 'EEEE, d MMMM')}</Text>
                <Text type="supporting">{list.length ? `${list.length} зап.` : 'свободно'}</Text>
              </HStack>
            }
          >
            {list.map((b) => (
              <BookingRow key={b.id} b={b} tz={tz} onOpen={onOpen} currency={currency} />
            ))}
            {bl.map((x) => (
              <BlockRow key={x.id} x={x} tz={tz} />
            ))}
          </List>
        );
      })}
    </VStack>
  );
}
