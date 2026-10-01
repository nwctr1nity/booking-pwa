import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { CalendarBlank } from '@phosphor-icons/react';
import { myBookings, type SavedBooking } from '@/lib/my-bookings';
import { rpc } from '@/lib/api';
import type { PublicBooking } from '@/lib/types';
import { useBookingFlow } from '@/features/booking/useBookingFlow';
import { useStudio } from '@/features/studio/StudioContext';
import { studioKeys } from '@/features/studio/queries';
import { tokenFromHash } from './links';
import { BookingCard } from './BookingCard';

export function MyBookingPage() {
  const studio = useStudio();
  const flow = useBookingFlow();
  const qc = useQueryClient();
  const [saved, setSaved] = useState<SavedBooking[]>(() => myBookings.list(studio.slug));
  const [importing, setImporting] = useState(() => !!tokenFromHash(location.hash));
  const [importError, setImportError] = useState(false);

  useEffect(() => {
    document.title = `Моя запись — ${studio.name}`;
  }, [studio.name]);

  // A booking link opened on another device: #t=<token>.
  useEffect(() => {
    const token = tokenFromHash(location.hash);
    if (!token) return;
    history.replaceState(history.state, '', location.pathname + location.search);
    rpc<PublicBooking>('public_get_booking', { p_slug: studio.slug, p_token: token })
      .then((b) => {
        myBookings.save(studio.slug, { ...b, access_token: token });
        qc.setQueryData(studioKeys.booking(studio.slug, token), b);
        setSaved(myBookings.list(studio.slug));
      })
      .catch(() => setImportError(true))
      .finally(() => setImporting(false));
  }, [studio.slug, qc]);

  const now = Date.now();
  const sorted = [...saved].sort((a, b) => {
    const fa = Date.parse(a.starts_at) >= now - 86_400_000;
    const fb = Date.parse(b.starts_at) >= now - 86_400_000;
    if (fa !== fb) return fa ? -1 : 1;
    return fa ? a.starts_at.localeCompare(b.starts_at) : b.starts_at.localeCompare(a.starts_at);
  });

  return (
    <main className="app-page">
      <VStack gap={5} padding={4} paddingBlockStart={6}>
        <VStack gap={1}>
          <h1 className="section-title">Моя запись</h1>
          <Text color="secondary">Записи, сделанные на этом устройстве.</Text>
        </VStack>
        {importError ? <Text color="secondary">Ссылка на запись недействительна или запись удалена.</Text> : null}
        {importing ? null : sorted.length === 0 ? (
          <EmptyState
            icon={<CalendarBlank size={32} />}
            title="Записей пока нет"
            description="Запишитесь онлайн: запись появится здесь. Если записывались с другого телефона, откройте ссылку на запись оттуда."
            actions={<Button variant="primary" label="Записаться" onClick={() => flow.open()} />}
          />
        ) : (
          sorted.map((s) => (
            <BookingCard
              key={s.token}
              saved={s}
              onForget={() => {
                myBookings.remove(studio.slug, s.token);
                setSaved(myBookings.list(studio.slug));
              }}
            />
          ))
        )}
        {sorted.length > 0 ? <Button label="Записаться ещё" onClick={() => flow.open()} width="100%" /> : null}
      </VStack>
    </main>
  );
}
