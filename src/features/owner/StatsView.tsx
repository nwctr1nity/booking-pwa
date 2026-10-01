import { useState } from 'react';
import { Card } from '@astryxdesign/core/Card';
import { Grid } from '@astryxdesign/core/Grid';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { QueryState } from '@/components/QueryState';
import { formatMoney } from '@/lib/money';
import { addLocalDays, fmtLocalDate, studioToday, weekRange } from '@/lib/time';
import type { OwnerStats } from '@/lib/types';
import { useOwnerTenant } from './OwnerContext';
import { useOwnerStats } from './queries';

type Period = 'day' | 'week' | 'month';

function monthRange(date: string) {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` };
}

function shiftMonth(date: string, n: number) {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

export function StatsView() {
  const tenant = useOwnerTenant();
  const today = studioToday(tenant.timezone);
  const [period, setPeriod] = useState<Period>('week');
  const [date, setDate] = useState(today);
  const range = period === 'day' ? { from: date, to: date } : period === 'week' ? weekRange(date) : monthRange(date);
  const q = useOwnerStats(tenant.id, range.from, range.to);
  const shift = (n: number) => setDate(period === 'month' ? shiftMonth(date, n) : addLocalDays(date, n * (period === 'day' ? 1 : 7)));
  const label =
    period === 'day' ? fmtLocalDate(range.from, 'd MMMM') : period === 'week' ? `${fmtLocalDate(range.from, 'd MMM')} – ${fmtLocalDate(range.to, 'd MMM')}` : fmtLocalDate(range.from, 'LLLL yyyy');

  return (
    <VStack gap={4}>
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <SegmentedControl label="Период" value={period} onChange={(v) => setPeriod(v as Period)}>
          <SegmentedControlItem value="day" label="День" />
          <SegmentedControlItem value="week" label="Неделя" />
          <SegmentedControlItem value="month" label="Месяц" />
        </SegmentedControl>
        <HStack gap={1} vAlign="center">
          <IconButton variant="ghost" label="Назад" icon={<CaretLeft size={18} />} onClick={() => shift(-1)} />
          <Text weight="semibold">{label}</Text>
          <IconButton variant="ghost" label="Вперёд" icon={<CaretRight size={18} />} onClick={() => shift(1)} />
        </HStack>
      </HStack>
      <QueryState query={q}>{(s) => <StatTiles stats={s} />}</QueryState>
      <Text type="supporting">
        Все цифры считаются на сервере за выбранные даты по времени студии ({tenant.timezone}). «Получено» — реально внесённые деньги минус возвраты. «Ожидается» — цена ещё
        не выполненных записей, это не выручка.
      </Text>
    </VStack>
  );
}

export function StatTiles({ stats, compact }: { stats: OwnerStats; compact?: boolean }) {
  const tiles = [
    { label: 'Приехали', value: String(stats.arrivals) },
    { label: 'Выполнено', value: String(stats.completed) },
    { label: 'Получено', value: formatMoney(stats.net_cents, stats.currency), hint: stats.refunded_cents ? `возвраты ${formatMoney(stats.refunded_cents, stats.currency)}` : undefined },
    ...(compact
      ? []
      : [
          { label: 'Записей', value: String(stats.scheduled) },
          { label: 'Ожидается', value: formatMoney(stats.planned_value_cents, stats.currency), hint: 'не выручка' },
          { label: 'Отмены / неявки', value: `${stats.cancelled} / ${stats.no_show}` },
        ]),
  ];
  return (
    <Grid columns={{ minWidth: compact ? 100 : 140 }} gap={2}>
      {tiles.map((t) => (
        <Card key={t.label} padding={3}>
          <VStack gap={0.5}>
            <Text type="supporting">{t.label}</Text>
            <Text weight="bold" size="xl" hasTabularNumbers>
              {t.value}
            </Text>
            {t.hint ? <Text type="supporting">{t.hint}</Text> : null}
          </VStack>
        </Card>
      ))}
    </Grid>
  );
}
