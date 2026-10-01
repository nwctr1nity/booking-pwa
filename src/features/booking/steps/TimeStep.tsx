import { useEffect, useMemo, useRef } from 'react';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { HStack } from '@astryxdesign/core/HStack';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarX } from '@phosphor-icons/react';
import { ErrorState } from '@/components/QueryState';
import { addLocalDays, fmtLocalDate, fmtTime, studioToday } from '@/lib/time';
import type { SlotDay } from '@/lib/types';
import { useStudio } from '@/features/studio/StudioContext';
import { useSlotsQuery } from '@/features/studio/queries';

const WINDOW = 14;

export function TimeStep({
  serviceId,
  day,
  startsAt,
  onDay,
  onPick,
}: {
  serviceId: string;
  day: string | null;
  startsAt: string | null;
  onDay: (day: string) => void;
  onPick: (startsAt: string, day: string) => void;
}) {
  const studio = useStudio();
  const tz = studio.timezone;
  const today = studioToday(tz);
  const lastDay = addLocalDays(today, studio.horizon_days);
  // The 14-day window that contains the selected day.
  const offset = day ? Math.max(0, Math.floor(dayDiff(today, day) / WINDOW) * WINDOW) : 0;
  const from = addLocalDays(today, offset);
  const q = useSlotsQuery(studio.slug, serviceId, from, WINDOW);
  const service = studio.services.find((s) => s.id === serviceId);

  const days = useMemo(() => (q.data?.days ?? []).filter((d) => d.date <= lastDay), [q.data, lastDay]);
  const firstFree = days.find((d) => d.slots.some((s) => s.available));
  const selected: SlotDay | undefined = days.find((d) => d.date === day) ?? (day ? undefined : firstFree);

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [selected?.date]);

  if (!service) return <EmptyState title="Услуга недоступна" description="Выберите другую услугу." />;
  if (!q.data && q.isPending) {
    return (
      <VStack gap={3} aria-busy="true" aria-label="Загружаем свободное время">
        <Skeleton height={64} />
        <Skeleton height={140} index={1} />
      </VStack>
    );
  }
  if (!q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;

  const canPrev = offset > 0;
  const canNext = addLocalDays(from, WINDOW) <= lastDay;

  return (
    <VStack gap={4}>
      <div className="day-strip" ref={stripRef} role="group" aria-label="Дата">
        {days.map((d) => {
          const free = d.slots.filter((s) => s.available).length;
          return (
            <button
              key={d.date}
              type="button"
              className="day-chip"
              aria-pressed={selected?.date === d.date}
              disabled={!d.is_open}
              aria-label={`${fmtLocalDate(d.date, 'd MMMM, EEEE')}: ${!d.is_open ? 'выходной' : free ? `свободно ${free}` : 'всё занято'}`}
              onClick={() => onDay(d.date)}
            >
              <Text type="supporting" color="inherit">
                {fmtLocalDate(d.date, 'EEEEEE')}
              </Text>
              <Text weight="semibold" color="inherit" hasTabularNumbers>
                {fmtLocalDate(d.date, 'd')}
              </Text>
              <Text type="supporting" size="2xs" color="inherit">
                {!d.is_open ? 'вых' : free ? fmtLocalDate(d.date, 'MMM') : 'занято'}
              </Text>
            </button>
          );
        })}
      </div>
      <HStack justify="between">
        <Button size="sm" variant="ghost" label="Раньше" isDisabled={!canPrev} onClick={() => onDay(addLocalDays(from, -WINDOW))} />
        <Text type="supporting">{q.isFetching ? 'Обновляем…' : `Время: ${tzLabel(tz)}`}</Text>
        <Button size="sm" variant="ghost" label="Позже" isDisabled={!canNext} onClick={() => onDay(addLocalDays(from, WINDOW))} />
      </HStack>

      {!selected ? (
        <EmptyState
          isCompact
          icon={<CalendarX size={28} />}
          title="Нет свободного времени"
          description={canNext ? 'В эти две недели всё занято. Посмотрите следующие даты.' : 'Позвоните в студию, чтобы подобрать время.'}
          actions={canNext ? <Button label="Следующие даты" onClick={() => onDay(addLocalDays(from, WINDOW))} /> : undefined}
        />
      ) : !selected.is_open ? (
        <EmptyState isCompact title="Выходной" description="В этот день студия не работает." />
      ) : selected.slots.length === 0 ? (
        <EmptyState isCompact title="На этот день записи нет" description="Выберите другой день." />
      ) : (
        <VStack gap={2}>
          <Text weight="semibold">{fmtLocalDate(selected.date, 'd MMMM, EEEE')}</Text>
          <div className="slot-grid" role="group" aria-label="Время начала">
            {selected.slots.map((s) => {
              const t = fmtTime(s.starts_at, tz);
              return (
                <button
                  key={s.starts_at}
                  type="button"
                  className="slot-chip"
                  disabled={!s.available}
                  aria-pressed={startsAt === s.starts_at}
                  aria-label={s.available ? t : `${t}, занято`}
                  onClick={() => onPick(s.starts_at, selected.date)}
                >
                  {t}
                </button>
              );
            })}
          </div>
          <Text type="supporting">Зачёркнутое время уже занято.</Text>
        </VStack>
      )}
    </VStack>
  );
}

function dayDiff(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

function tzLabel(tz: string) {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return local === tz ? 'местное' : `по часовому поясу студии`;
}
