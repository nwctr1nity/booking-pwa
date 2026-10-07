import { useEffect, useState } from 'react';
import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { DateInput } from '@astryxdesign/core/DateInput';
import { HStack } from '@astryxdesign/core/HStack';
import { Selector } from '@astryxdesign/core/Selector';
import { Text } from '@astryxdesign/core/Text';
import { TextArea } from '@astryxdesign/core/TextArea';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TimeInput } from '@astryxdesign/core/TimeInput';
import { VStack } from '@astryxdesign/core/VStack';
import { useToast } from '@astryxdesign/core/Toast';
import { rpc } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { newRequestKey } from '@/lib/ids';
import { formatPrice } from '@/lib/money';
import { fmtDuration, fmtTime, zonedToIso, isoDate, isoTime } from '@/lib/time';
import type { OwnerBooking } from '@/lib/types';
import { contactsSchemaFor, fieldErrors } from '@/lib/validation';
import { useStudio } from '@/features/studio/StudioContext';
import { useSlotsQuery } from '@/features/studio/queries';
import { useOwnerTenant } from './OwnerContext';
import { useBookingMutation, useOwnerSettings } from './queries';
import { Sheet } from './Sheet';
import { ownerWords } from '@/features/studio/words';

const telInput = { inputMode: 'tel' } as Record<string, string>;

export function NewBookingSheet({ open, defaultDay, onClose, onCreated }: { open: boolean; defaultDay: string; onClose: () => void; onCreated: (id: string, day: string) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Новая запись" description="Запись по телефону или от администратора">
      {open ? <NewBookingForm defaultDay={defaultDay} onClose={onClose} onCreated={onCreated} /> : null}
    </Sheet>
  );
}

function NewBookingForm({ defaultDay, onClose, onCreated }: { defaultDay: string; onClose: () => void; onCreated: (id: string, day: string) => void }) {
  const tenant = useOwnerTenant();
  const w = ownerWords(useStudio().kind);
  const studio = useStudio();
  const toast = useToast();
  const settings = useOwnerSettings(tenant.id);
  const services = (settings.data?.services ?? []).filter((s) => s.is_active);
  const [serviceId, setServiceId] = useState('');
  const [day, setDay] = useState(defaultDay);
  const [time, setTime] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [c, setC] = useState({ name: '', phone: '', car: '', comment: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [key] = useState(newRequestKey);

  useEffect(() => {
    if (!serviceId && services[0]) setServiceId(services[0].id);
  }, [serviceId, services]);

  const service = services.find((s) => s.id === serviceId);
  const resources = (settings.data?.resources ?? []).filter((r) => r.is_active && service?.resource_ids.includes(r.id));
  const slots = useSlotsQuery(studio.slug, serviceId || null, day, 1);
  const free = slots.data?.days[0]?.slots.filter((s) => s.available) ?? [];

  const m = useBookingMutation(tenant.id, (vars: { startsAt: string; phone: string }) =>
    rpc<OwnerBooking>('owner_create_booking', {
      p_tenant: tenant.id,
      p_service_id: serviceId,
      p_starts_at: vars.startsAt,
      p_resource_id: resourceId || null,
      p_name: c.name.trim(),
      p_phone: vars.phone,
      p_car: c.car.trim(),
      p_comment: c.comment.trim(),
      p_idempotency_key: key,
    }),
  );

  const submit = () => {
    const res = contactsSchemaFor(w.hasCar).safeParse(c);
    const errs = fieldErrors(res);
    if (!time) errs.time = 'Укажите время';
    setErrors(errs);
    if (!res.success || !time || !service) return;
    m.mutate(
      { startsAt: zonedToIso(day, time.slice(0, 5), tenant.timezone), phone: res.data.phone },
      {
        onSuccess: (b) => {
          toast({ body: 'Запись добавлена' });
          onClose();
          onCreated(b.id, day);
        },
      },
    );
  };

  const st = (k: string) => (errors[k] ? { type: 'error' as const, message: errors[k] } : undefined);

  if (settings.data && services.length === 0) return <Banner status="warning" title="Сначала добавьте услугу в настройках" collapsible={false} />;

  return (
    <VStack gap={4}>
      <Selector
        label="Услуга"
        value={serviceId}
        onChange={(v) => { setServiceId(v ?? ''); setResourceId(''); }}
        options={services.map((s) => ({ value: s.id, label: s.name, description: `${fmtDuration(s.duration_minutes)} · ${formatPrice(s.price_cents, s.price_is_from, tenant.currency)}` }))}
        isLoading={settings.isPending}
        presentation="adaptive"
        width="100%"
      />
      <HStack gap={2} wrap="wrap">
        <DateInput label="Дата" value={isoDate(day)} onChange={(v) => v && setDay(v)} weekStartsOn="mon" />
        <TimeInput label="Время" value={isoTime(time)} onChange={(v) => setTime(v ?? '')} hourFormat="24h" increment={5} status={st('time')} />
      </HStack>
      {serviceId ? (
        <VStack gap={2}>
          <Text type="supporting">{slots.isPending ? 'Ищем свободное время…' : free.length ? 'Свободно по расписанию:' : 'По расписанию свободного времени нет, можно указать время вручную.'}</Text>
          {free.length ? (
            <div className="slot-grid">
              {free.slice(0, 24).map((s) => {
                const t = fmtTime(s.starts_at, tenant.timezone);
                return (
                  <button key={s.starts_at} type="button" className="slot-chip" aria-pressed={time.slice(0, 5) === t} onClick={() => setTime(t)}>
                    {t}
                  </button>
                );
              })}
            </div>
          ) : null}
        </VStack>
      ) : null}
      <Selector
        label={w.resource}
        value={resourceId}
        onChange={(v) => setResourceId(v ?? '')}
        options={[{ value: '', label: 'Любой подходящий свободный' }, ...resources.map((r) => ({ value: r.id, label: r.name }))]}
        width="100%"
      />
      <TextInput label="Имя клиента" value={c.name} onChange={(v) => setC({ ...c, name: v })} status={st('name')} statusVariant="detached" width="100%" />
      <TextInput label="Телефон" value={c.phone} onChange={(v) => setC({ ...c, phone: v })} status={st('phone')} statusVariant="detached" width="100%" {...telInput} />
      {w.hasCar ? <TextInput label="Автомобиль" value={c.car} onChange={(v) => setC({ ...c, car: v })} status={st('car')} statusVariant="detached" width="100%" /> : null}
      <TextArea label="Комментарий" value={c.comment} onChange={(v) => setC({ ...c, comment: v })} isOptional rows={2} width="100%" />
      {m.error ? <Banner status="error" title={errorMessage(m.error)} collapsible={false} /> : null}
      <Button variant="primary" size="lg" label="Добавить запись" isLoading={m.isPending} onClick={submit} width="100%" />
    </VStack>
  );
}
