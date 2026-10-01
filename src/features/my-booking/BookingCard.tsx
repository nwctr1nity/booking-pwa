import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Card } from '@astryxdesign/core/Card';
import { HStack } from '@astryxdesign/core/HStack';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Skeleton } from '@astryxdesign/core/Skeleton';
import { Text } from '@astryxdesign/core/Text';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { LinkSimple, Phone } from '@phosphor-icons/react';
import { rpc } from '@/lib/api';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/money';
import { myBookings, type SavedBooking } from '@/lib/my-bookings';
import { fmtDateTime, fmtDuration } from '@/lib/time';
import type { BookingStatus, PublicBooking } from '@/lib/types';
import { ErrorState } from '@/components/QueryState';
import { ReminderOffer } from '@/features/booking/ReminderOffer';
import { useStudio } from '@/features/studio/StudioContext';
import { studioKeys, useBookingQuery } from '@/features/studio/queries';
import { bookingLink } from './links';

const STATUS: Record<BookingStatus, { label: string; color: 'blue' | 'green' | 'gray' | 'red' | 'orange' }> = {
  confirmed: { label: 'Подтверждена', color: 'blue' },
  arrived: { label: 'Автомобиль принят', color: 'orange' },
  done: { label: 'Готово', color: 'green' },
  cancelled: { label: 'Отменена', color: 'gray' },
  no_show: { label: 'Неявка', color: 'red' },
};

export function BookingCard({ saved, onForget }: { saved: SavedBooking; onForget: () => void }) {
  const studio = useStudio();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useBookingQuery(studio.slug, saved.token);
  const [confirming, setConfirming] = useState(false);
  const b = q.data ?? saved.snapshot;

  useEffect(() => {
    if (q.data) myBookings.updateSnapshot(studio.slug, saved.token, q.data);
  }, [q.data, studio.slug, saved.token]);

  const cancel = useMutation({
    mutationFn: () => rpc<PublicBooking>('public_cancel_booking', { p_slug: studio.slug, p_token: saved.token }),
    onSuccess: (nb) => {
      qc.setQueryData(studioKeys.booking(studio.slug, saved.token), nb);
      void qc.invalidateQueries({ queryKey: ['public', 'slots', studio.slug] });
      setConfirming(false);
      toast({ body: 'Запись отменена' });
    },
  });

  if (q.error instanceof ApiError && q.error.code === 'booking_not_found') {
    return (
      <Card>
        <VStack gap={3}>
          <Text>Запись {b ? `на ${fmtDateTime(b.starts_at, studio.timezone)}` : ''} больше не найдена: студия могла её удалить.</Text>
          <Button label="Убрать с устройства" onClick={onForget} />
        </VStack>
      </Card>
    );
  }
  if (!b) {
    return q.isPending ? <Skeleton height={220} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} compact />;
  }

  const st = STATUS[b.status];
  const link = bookingLink(studio.slug, saved.token);
  const past = Date.parse(b.ends_at) < Date.now();

  return (
    <Card padding={4}>
      <VStack gap={4}>
        <HStack justify="between" vAlign="center" gap={2}>
          <Text weight="semibold" size="lg">
            {b.service_name}
          </Text>
          <Token label={st.label} color={st.color} size="sm" />
        </HStack>
        {q.isError && !(q.error instanceof ApiError && q.error.code === 'booking_not_found') ? (
          <Text type="supporting">Показана сохранённая копия: нет связи со студией.</Text>
        ) : null}
        <MetadataList>
          <MetadataListItem label="Когда">{fmtDateTime(b.starts_at, b.studio.timezone)}</MetadataListItem>
          <MetadataListItem label="Длительность">{fmtDuration(b.duration_minutes)}</MetadataListItem>
          <MetadataListItem label="Стоимость">{formatPrice(b.price_cents, b.price_is_from, b.studio.currency)}</MetadataListItem>
          <MetadataListItem label="Место">{b.resource_name}</MetadataListItem>
          <MetadataListItem label="Автомобиль">{b.car}</MetadataListItem>
          <MetadataListItem label="Адрес">{b.studio.address}</MetadataListItem>
        </MetadataList>
        {b.is_demo ? <Text type="supporting">Тестовая запись демо-версии.</Text> : null}

        {b.status === 'confirmed' && !past ? <ReminderOffer booking={b} token={saved.token} slug={studio.slug} url={link} /> : null}

        {confirming ? (
          <Banner
            status="warning"
            title="Отменить запись?"
            description="Время освободится для других клиентов."
            collapsible={false}
            endContent={
              <HStack gap={2}>
                <Button size="sm" variant="ghost" label="Нет" onClick={() => setConfirming(false)} />
                <Button size="sm" variant="destructive" label="Отменить" isLoading={cancel.isPending} onClick={() => cancel.mutate()} />
              </HStack>
            }
          />
        ) : null}
        {cancel.error ? <Banner status="error" title={errorMessage(cancel.error)} collapsible={false} /> : null}

        <HStack gap={2} wrap="wrap">
          {b.can_cancel && !confirming ? <Button variant="destructive" label="Отменить запись" onClick={() => setConfirming(true)} /> : null}
          {b.studio.phone ? <Button icon={<Phone size={18} />} label="Позвонить" href={`tel:${b.studio.phone.replace(/[^+\d]/g, '')}`} /> : null}
          <Button
            variant="ghost"
            icon={<LinkSimple size={18} />}
            label="Ссылка на запись"
            clickAction={async () => {
              try {
                if (navigator.share) await navigator.share({ title: b.service_name, url: link });
                else {
                  await navigator.clipboard.writeText(link);
                  toast({ body: 'Ссылка скопирована. Не пересылайте её посторонним: по ней можно отменить запись.' });
                }
              } catch {
                /* share dismissed */
              }
            }}
          />
          {b.status === 'confirmed' && !b.can_cancel && !past ? (
            <Text type="supporting">Отменить онлайн уже нельзя, позвоните в студию.</Text>
          ) : null}
          {b.status !== 'confirmed' || past ? <Button variant="ghost" label="Убрать с устройства" onClick={onForget} /> : null}
        </HStack>
      </VStack>
    </Card>
  );
}
