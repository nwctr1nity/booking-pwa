import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { Divider } from '@astryxdesign/core/Divider';
import { HStack } from '@astryxdesign/core/HStack';
import { List, ListItem } from '@astryxdesign/core/List';
import { MetadataList, MetadataListItem } from '@astryxdesign/core/MetadataList';
import { NumberInput } from '@astryxdesign/core/NumberInput';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { Token } from '@astryxdesign/core/Token';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { Phone } from '@phosphor-icons/react';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { newRequestKey } from '@/lib/ids';
import { formatMoney, formatPrice } from '@/lib/money';
import { fmtDateTime, fmtDuration, zonedParts, zonedToIso, isoDate, isoTime } from '@/lib/time';
import type { BookingStatus, OwnerBooking } from '@/lib/types';
import { useOwnerTenant } from './OwnerContext';
import { useBookingMutation, useOwnerSettings } from './queries';
import { METHOD_LABEL, STATUS_META } from './format';
import { Sheet } from './Sheet';

type Panel = null | 'reschedule' | 'cancel' | 'payment';

const NEXT: Partial<Record<BookingStatus, { to: BookingStatus; label: string; variant: 'primary' | 'secondary' | 'ghost' }[]>> = {
  confirmed: [
    { to: 'arrived', label: 'Автомобиль принят', variant: 'primary' },
    { to: 'no_show', label: 'Неявка', variant: 'ghost' },
  ],
  arrived: [
    { to: 'done', label: 'Готов к выдаче', variant: 'primary' },
    { to: 'confirmed', label: 'Вернуть в ожидание', variant: 'ghost' },
  ],
  done: [{ to: 'arrived', label: 'Вернуть в работу', variant: 'ghost' }],
  no_show: [{ to: 'confirmed', label: 'Снять неявку', variant: 'ghost' }],
};

export function BookingSheet({ booking, onClose }: { booking: OwnerBooking | null; onClose: () => void }) {
  const [last, setLast] = useState<OwnerBooking | null>(booking);
  useEffect(() => {
    if (booking) setLast(booking);
  }, [booking]);
  const b = booking ?? last;
  return (
    <Sheet open={!!booking} onClose={onClose} title={b?.service_name ?? ''} description={b ? `${b.customer_name} · ${b.car}` : ''}>
      {b ? <BookingDetails key={b.id} b={b} /> : null}
    </Sheet>
  );
}

function BookingDetails({ b }: { b: OwnerBooking }) {
  const tenant = useOwnerTenant();
  const tz = tenant.timezone;
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const meta = STATUS_META[b.status];
  const net = b.paid_cents - b.refunded_cents;

  const status = useBookingMutation(tenant.id, (to: BookingStatus) =>
    rpc('owner_set_booking_status', { p_tenant: tenant.id, p_booking_id: b.id, p_status: to }),
  );

  return (
    <VStack gap={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Token label={meta.label} color={meta.color} />
        {b.is_demo ? <Token label="Демо" color="gray" size="sm" /> : null}
        {b.source === 'owner' ? <Token label="Добавлена вручную" size="sm" /> : null}
      </HStack>
      <MetadataList>
        <MetadataListItem label="Начало">{fmtDateTime(b.starts_at, tz)}</MetadataListItem>
        <MetadataListItem label="Окончание">{fmtDateTime(b.ends_at, tz)}</MetadataListItem>
        <MetadataListItem label="Длительность">{fmtDuration(b.duration_minutes)}</MetadataListItem>
        <MetadataListItem label="Пост">{b.resource_name}</MetadataListItem>
        <MetadataListItem label="Цена при записи">{formatPrice(b.price_cents, b.price_is_from, tenant.currency)}</MetadataListItem>
        <MetadataListItem label="Оплачено">{formatMoney(net, tenant.currency)}</MetadataListItem>
        <MetadataListItem label="Телефон">{b.customer_phone}</MetadataListItem>
        {b.comment ? <MetadataListItem label="Комментарий">{b.comment}</MetadataListItem> : null}
        {b.cancel_reason ? <MetadataListItem label="Причина отмены">{b.cancel_reason}</MetadataListItem> : null}
      </MetadataList>

      {status.error ? <Banner status="error" title={errorMessage(status.error)} collapsible={false} /> : null}
      <HStack gap={2} wrap="wrap">
        {(NEXT[b.status] ?? []).map((n) => (
          <Button
            key={n.to}
            variant={n.variant}
            label={n.label}
            isLoading={status.isPending && status.variables === n.to}
            onClick={() => status.mutate(n.to, { onSuccess: () => toast({ body: `Статус: ${STATUS_META[n.to].label}` }) })}
          />
        ))}
        <Button icon={<Phone size={18} />} label="Позвонить" href={`tel:${b.customer_phone}`} />
      </HStack>

      <Divider />
      <HStack gap={2} wrap="wrap">
        {b.status === 'confirmed' ? <Button label="Перенести" onClick={() => setPanel(panel === 'reschedule' ? null : 'reschedule')} /> : null}
        {b.status !== 'cancelled' ? <Button label="Оплата / возврат" onClick={() => setPanel(panel === 'payment' ? null : 'payment')} /> : null}
        {b.status === 'confirmed' || b.status === 'arrived' ? (
          <Button variant="destructive" label="Отменить" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')} />
        ) : null}
      </HStack>

      {panel === 'reschedule' ? <ReschedulePanel b={b} onDone={() => setPanel(null)} /> : null}
      {panel === 'cancel' ? <CancelPanel b={b} onDone={() => setPanel(null)} /> : null}
      {panel === 'payment' ? <PaymentPanel b={b} onDone={() => setPanel(null)} /> : null}

      {b.payments.length > 0 ? (
        <List hasDividers header={<Text weight="semibold">Платежи</Text>} density="compact">
          {b.payments.map((p) => (
            <ListItem
              key={p.id}
              label={`${p.kind === 'refund' ? '−' : '+'}${formatMoney(p.amount_cents, tenant.currency)} · ${METHOD_LABEL[p.method]}`}
              description={`${fmtDateTime(p.paid_at, tz)}${p.note ? ` · ${p.note}` : ''}`}
              endContent={p.kind === 'refund' ? <Token size="sm" color="red" label="Возврат" /> : undefined}
            />
          ))}
        </List>
      ) : null}
    </VStack>
  );
}

function ReschedulePanel({ b, onDone }: { b: OwnerBooking; onDone: () => void }) {
  const tenant = useOwnerTenant();
  const settings = useOwnerSettings(tenant.id);
  const toast = useToast();
  const cur = zonedParts(b.starts_at, tenant.timezone);
  const [day, setDay] = useState(cur.date);
  const [time, setTime] = useState(cur.time);
  const [resource, setResource] = useState<string>('');
  const m = useBookingMutation(tenant.id, () =>
    rpc('owner_reschedule_booking', {
      p_tenant: tenant.id,
      p_booking_id: b.id,
      p_new_starts_at: zonedToIso(day, time.slice(0, 5), tenant.timezone),
      p_resource_id: resource || null,
      p_expected_version: b.version,
    }),
  );
  const resources = (settings.data?.resources ?? []).filter((r) => r.is_active);
  return (
    <VStack gap={3}>
      <Text weight="semibold">Перенос записи</Text>
      <HStack gap={2} wrap="wrap">
        <DateInput label="Дата" value={isoDate(day)} onChange={(v) => v && setDay(v)} weekStartsOn="mon" />
        <TimeInput label="Время" value={isoTime(time)} onChange={(v) => v && setTime(v)} hourFormat="24h" increment={5} />
      </HStack>
      <Selector
        label="Пост"
        value={resource}
        onChange={(v) => setResource(v ?? '')}
        options={[{ value: '', label: 'Тот же или любой свободный' }, ...resources.map((r) => ({ value: r.id, label: r.name }))]}
        width="100%"
      />
      <Text type="supporting">Если новое время занято, запись останется на прежнем месте.</Text>
      {m.error ? <Banner status="error" title={errorMessage(m.error)} collapsible={false} /> : null}
      <Button
        variant="primary"
        label="Перенести"
        isLoading={m.isPending}
        onClick={() => m.mutate(undefined, { onSuccess: () => { toast({ body: 'Запись перенесена' }); onDone(); } })}
      />
    </VStack>
  );
}

function CancelPanel({ b, onDone }: { b: OwnerBooking; onDone: () => void }) {
  const tenant = useOwnerTenant();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const m = useBookingMutation(tenant.id, () => rpc('owner_cancel_booking', { p_tenant: tenant.id, p_booking_id: b.id, p_reason: reason }));
  return (
    <VStack gap={3}>
      <TextInput label="Причина" value={reason} onChange={setReason} isOptional placeholder="Например: клиент перенёс по телефону" width="100%" />
      {m.error ? <Banner status="error" title={errorMessage(m.error)} collapsible={false} /> : null}
      <Button
        variant="destructive"
        label="Отменить запись"
        isLoading={m.isPending}
        onClick={() => m.mutate(undefined, { onSuccess: () => { toast({ body: 'Запись отменена, время освобождено' }); onDone(); } })}
      />
    </VStack>
  );
}

function PaymentPanel({ b, onDone }: { b: OwnerBooking; onDone: () => void }) {
  const tenant = useOwnerTenant();
  const toast = useToast();
  const [kind, setKind] = useState<'payment' | 'refund'>('payment');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<keyof typeof METHOD_LABEL>('card');
  const [note, setNote] = useState('');
  // One key per entered payment: a double tap or a retry after a lost
  // response never records the money twice.
  const [key, setKey] = useState(newRequestKey);
  const m = useBookingMutation(tenant.id, () =>
    rpc('owner_add_payment', {
      p_tenant: tenant.id,
      p_booking_id: b.id,
      p_kind: kind,
      p_amount_cents: Math.round((amount ?? 0) * 100),
      p_method: method,
      p_note: note,
      p_idempotency_key: key,
    }),
  );
  const net = b.paid_cents - b.refunded_cents;
  return (
    <VStack gap={3}>
      <SegmentedControl label="Тип" value={kind} onChange={(v) => { setKind(v as 'payment' | 'refund'); setKey(newRequestKey()); }} layout="fill">
        <SegmentedControlItem value="payment" label="Оплата" />
        <SegmentedControlItem value="refund" label="Возврат" />
      </SegmentedControl>
      <NumberInput label="Сумма" value={amount} onChange={(v) => { setAmount(v); setKey(newRequestKey()); }} units="₽" min={0} width="100%" />
      <Selector label="Способ" value={method} onChange={(v) => v && setMethod(v as keyof typeof METHOD_LABEL)} options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} width="100%" />
      <TextInput label="Заметка" value={note} onChange={setNote} isOptional width="100%" />
      {kind === 'refund' ? <Text type="supporting">Можно вернуть не больше {formatMoney(net, tenant.currency)}.</Text> : null}
      {m.error ? <Banner status="error" title={errorMessage(m.error)} collapsible={false} /> : null}
      <Button
        variant="primary"
        label={kind === 'payment' ? 'Записать оплату' : 'Записать возврат'}
        isDisabled={!amount || amount <= 0}
        isLoading={m.isPending}
        onClick={() =>
          m.mutate(undefined, {
            onSuccess: () => {
              toast({ body: kind === 'payment' ? 'Оплата записана' : 'Возврат записан' });
              setKey(newRequestKey());
              onDone();
            },
          })
        }
      />
    </VStack>
  );
}
