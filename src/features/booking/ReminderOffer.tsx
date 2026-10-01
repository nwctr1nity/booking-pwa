import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@astryxdesign/core/Button';
import { HStack } from '@astryxdesign/core/HStack';
import { StatusDot } from '@astryxdesign/core/StatusDot';
import { Text } from '@astryxdesign/core/Text';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { BellRinging, CalendarPlus } from '@phosphor-icons/react';
import { errorMessage } from '@/lib/errors';
import { buildIcs, downloadIcs } from '@/lib/ics';
import { pushSupport, subscribeReminder, unsubscribeReminder } from '@/lib/push';
import type { PublicBooking } from '@/lib/types';
import { studioKeys } from '@/features/studio/queries';

export function bookingIcs(b: PublicBooking, url: string) {
  return buildIcs({
    uid: `${b.id}@booking`,
    start: b.starts_at,
    end: b.ends_at,
    title: `${b.service_name} — ${b.studio.name}`,
    location: b.studio.address,
    description: [`Автомобиль: ${b.car}`, b.studio.phone ? `Телефон студии: ${b.studio.phone}` : '', `Запись: ${url}`].filter(Boolean).join('\n'),
    url,
    alarmHours: b.studio.reminder_hours,
  });
}

/**
 * Reminder one day ahead. Push only where the browser really supports it;
 * everywhere else (including an iPhone tab not added to the Home Screen)
 * the honest offer is a calendar file with its own alarm.
 */
export function ReminderOffer({ booking, token, slug, url }: { booking: PublicBooking; token: string; slug: string; url: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [support] = useState(pushSupport);
  const r = booking.reminder;
  const hours = booking.studio.reminder_hours;
  const tooLate = new Date(booking.starts_at).getTime() - hours * 3_600_000 <= Date.now();
  const refresh = () => qc.invalidateQueries({ queryKey: studioKeys.booking(slug, token) });

  const calendar = (
    <Button
      icon={<CalendarPlus size={18} />}
      label="Добавить в календарь"
      width="100%"
      onClick={() => downloadIcs(`zapis-${booking.starts_at.slice(0, 10)}.ics`, bookingIcs(booking, url))}
    />
  );

  if (booking.status !== 'confirmed') return null;

  let state: { dot: 'success' | 'warning' | 'neutral' | 'accent'; text: string } | null = null;
  let action: React.ReactNode = null;

  if (r.state === 'scheduled') {
    state = { dot: 'success', text: `Пришлём уведомление за ${hours} ч до визита.` };
    action = (
      <Button
        variant="ghost"
        label="Не напоминать"
        clickAction={async () => {
          try {
            await unsubscribeReminder(slug, token);
            await refresh();
          } catch (e) {
            toast({ body: errorMessage(e), type: 'error' });
          }
        }}
      />
    );
  } else if (r.state === 'preview') {
    state = { dot: 'neutral', text: 'Демо-режим: уведомления не отправляются.' };
  } else if (r.state === 'sent') {
    state = { dot: 'success', text: 'Напоминание отправлено.' };
  } else if (r.state === 'failed') {
    state = { dot: 'warning', text: 'Не удалось доставить напоминание. Добавьте запись в календарь.' };
  } else if (tooLate) {
    state = { dot: 'neutral', text: `До визита меньше ${hours} ч, напоминание не нужно.` };
  } else if (support.kind === 'supported') {
    action = (
      <Button
        variant="primary"
        width="100%"
        icon={<BellRinging size={18} />}
        label={`Напомнить за ${hours === 24 ? 'день' : `${hours} ч`}`}
        clickAction={async () => {
          try {
            await subscribeReminder(slug, token);
            await refresh();
          } catch (e) {
            toast({ body: errorMessage(e), type: 'error' });
          }
        }}
      />
    );
  } else if (support.kind === 'ios-needs-install') {
    state = { dot: 'neutral', text: 'На iPhone уведомления работают, только если добавить сайт на экран «Домой» (Поделиться → На экран «Домой»). Пока добавьте запись в календарь.' };
  } else if (support.kind === 'denied') {
    state = { dot: 'warning', text: 'Уведомления запрещены в настройках браузера. Добавьте запись в календарь.' };
  } else {
    state = { dot: 'neutral', text: 'Этот браузер не поддерживает уведомления. Добавьте запись в календарь, напоминание сработает оттуда.' };
  }

  return (
    <VStack gap={3}>
      {state ? (
        <HStack gap={2} align="start">
          <StatusDot variant={state.dot} label={state.text} />
          <Text>{state.text}</Text>
        </HStack>
      ) : null}
      {action}
      {calendar}
    </VStack>
  );
}
