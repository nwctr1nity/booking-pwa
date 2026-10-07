import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CheckCircle } from '@phosphor-icons/react';
import { LoadingRows, ErrorState } from '@/components/QueryState';
import { myBookings } from '@/lib/my-bookings';
import { formatPrice } from '@/lib/money';
import { fmtDateTime } from '@/lib/time';
import { useStudio } from '@/features/studio/StudioContext';
import { useBookingQuery } from '@/features/studio/queries';
import { bookingLink } from '@/features/my-booking/links';
import { ReminderOffer } from '../ReminderOffer';
import { placeWords } from '@/features/studio/words';

export function DoneStep({ bookingId, onClose, onOpenMine }: { bookingId: string; onClose: () => void; onOpenMine: () => void }) {
  const studio = useStudio();
  const saved = myBookings.list(studio.slug).find((b) => b.id === bookingId);
  const q = useBookingQuery(studio.slug, saved?.token ?? null);

  if (!saved) return <ErrorState error={new Error('not_found')} />;
  const b = q.data ?? saved.snapshot;
  if (!b) return q.isPending ? <LoadingRows /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <VStack gap={4}>
      <VStack gap={2} hAlign="center">
        <CheckCircle size={48} weight="fill" color="var(--color-success)" aria-hidden />
        <Heading level={3} justify="center">
          Вы записаны
        </Heading>
        <Text color="secondary" justify="center">
          {fmtDateTime(b.starts_at, b.studio.timezone)}
        </Text>
      </VStack>
      <MetadataList>
        <MetadataListItem label="Услуга">{b.service_name}</MetadataListItem>
        <MetadataListItem label="Стоимость">{formatPrice(b.price_cents, b.price_is_from, b.studio.currency)}</MetadataListItem>
        <MetadataListItem label={placeWords(studio.kind).resource}>{b.resource_name}</MetadataListItem>
        <MetadataListItem label="Адрес">{b.studio.address}</MetadataListItem>
      </MetadataList>
      <ReminderOffer booking={b} token={saved.token} slug={studio.slug} url={bookingLink(studio.slug, saved.token)} />
      <VStack gap={2}>
        <Button label="Моя запись" onClick={onOpenMine} width="100%" />
        <Button variant="ghost" label="Готово" onClick={onClose} width="100%" />
      </VStack>
    </VStack>
  );
}
