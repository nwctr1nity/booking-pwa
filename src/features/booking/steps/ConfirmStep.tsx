import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { rpc } from '@/lib/api';
import { ApiError, errorMessage } from '@/lib/errors';
import { formatPrice } from '@/lib/money';
import { myBookings } from '@/lib/my-bookings';
import { fmtDateTime, fmtDuration } from '@/lib/time';
import type { PublicBooking } from '@/lib/types';
import { contactsSchemaFor } from '@/lib/validation';
import { useStudio } from '@/features/studio/StudioContext';
import { studioKeys } from '@/features/studio/queries';
import { placeWords } from '@/features/studio/words';
import { clearDraft, readDraft } from '../draft';
import { clearPending, pendingKeyFor } from '../pending';

export function ConfirmStep({
  serviceId,
  startsAt,
  onBooked,
  onChangeTime,
  onEditContacts,
}: {
  serviceId: string;
  startsAt: string;
  onBooked: (b: PublicBooking & { access_token: string }) => void;
  onChangeTime: () => void;
  onEditContacts: () => void;
}) {
  const studio = useStudio();
  const qc = useQueryClient();
  const service = studio.services.find((s) => s.id === serviceId);
  const words = placeWords(studio.kind);
  const parsed = contactsSchemaFor(words.hasCar).safeParse(readDraft(studio.slug));
  const already = myBookings
    .list(studio.slug)
    .find((b) => b.snapshot?.starts_at === startsAt && b.snapshot.service_name === service?.name && b.snapshot.status === 'confirmed');

  const m = useMutation({
    mutationFn: async () => {
      if (!parsed.success) throw new ApiError('invalid_input');
      const c = { ...parsed.data, car: words.hasCar ? parsed.data.car : '' };
      const fingerprint = JSON.stringify([serviceId, startsAt, c.name, c.phone, c.car, c.comment]);
      return rpc<PublicBooking & { access_token: string }>('public_create_booking', {
        p_slug: studio.slug,
        p_service_id: serviceId,
        p_starts_at: startsAt,
        p_name: c.name,
        p_phone: c.phone,
        p_car: c.car,
        p_comment: c.comment,
        p_idempotency_key: pendingKeyFor(studio.slug, fingerprint),
      });
    },
    onSuccess: (b) => {
      myBookings.save(studio.slug, b);
      clearPending(studio.slug);
      clearDraft(studio.slug);
      void qc.invalidateQueries({ queryKey: ['public', 'slots', studio.slug] });
      qc.setQueryData(studioKeys.booking(studio.slug, b.access_token), b);
      onBooked(b);
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'slot_taken' || e.code === 'slot_unavailable')) {
        void qc.invalidateQueries({ queryKey: ['public', 'slots', studio.slug] });
      }
    },
  });

  if (!service) return <Banner status="error" title="Услуга больше недоступна" description="Выберите другую услугу." />;
  if (!parsed.success) {
    return (
      <VStack gap={3}>
        <Banner status="warning" title="Не хватает контактов" />
        <Button label="Заполнить контакты" variant="primary" onClick={onEditContacts} />
      </VStack>
    );
  }

  const c = parsed.data;
  const err = m.error;
  const timeGone = err instanceof ApiError && (err.code === 'slot_taken' || err.code === 'slot_unavailable');

  return (
    <VStack gap={4}>
      <MetadataList>
        <MetadataListItem label="Услуга">{service.name}</MetadataListItem>
        <MetadataListItem label="Когда">{fmtDateTime(startsAt, studio.timezone)}</MetadataListItem>
        <MetadataListItem label="Длительность">{fmtDuration(service.duration_minutes)}</MetadataListItem>
        <MetadataListItem label="Стоимость">{formatPrice(service.price_cents, service.price_is_from, studio.currency)}</MetadataListItem>
        <MetadataListItem label="Имя">{c.name}</MetadataListItem>
        <MetadataListItem label="Телефон">{c.phone}</MetadataListItem>
        {words.hasCar ? <MetadataListItem label="Автомобиль">{c.car}</MetadataListItem> : null}
        {c.comment ? <MetadataListItem label="Комментарий">{c.comment}</MetadataListItem> : null}
      </MetadataList>

      {studio.is_preview ? (
        <Banner status="info" title="Демо-режим" description={`${words.hasCar ? 'Студия ещё не запущена' : 'Салон ещё не запущен'}: запись сохранится как тестовая, уведомления не отправляются.`} />
      ) : null}

      {already ? (
        <Banner status="success" title="Вы уже записаны на это время" description="Запись есть в разделе «Моя запись»." />
      ) : err ? (
        <Banner
          status="error"
          title={errorMessage(err)}
          endContent={timeGone ? <Button size="sm" label="Выбрать время" onClick={onChangeTime} /> : undefined}
        />
      ) : null}

      <VStack gap={2}>
        <Button
          variant="primary"
          size="lg"
          width="100%"
          label={err && !timeGone ? 'Отправить ещё раз' : 'Записаться'}
          isLoading={m.isPending}
          isDisabled={!!already || timeGone}
          onClick={() => m.mutate()}
        />
        <Text type="supporting" justify="center">
          Отменить можно онлайн не позже чем за {studio.cancellation_hours} ч до визита.
        </Text>
      </VStack>
    </VStack>
  );
}
