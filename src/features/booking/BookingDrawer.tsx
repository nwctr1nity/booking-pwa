import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { HStack } from '@astryxdesign/core/HStack';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Text } from '@astryxdesign/core/Text';
import { ArrowLeft, X } from '@phosphor-icons/react';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { formatPrice } from '@/lib/money';
import { fmtDateTime, fmtDuration } from '@/lib/time';
import { useStudio } from '@/features/studio/StudioContext';
import { studioPath } from '@/features/studio/paths';
import { useBookingFlow, type BookingStep } from './useBookingFlow';
import { useVisualViewportHeight } from './useVisualViewport';
import { ServiceStep } from './steps/ServiceStep';
import { TimeStep } from './steps/TimeStep';
import { ContactsStep } from './steps/ContactsStep';
import { ConfirmStep } from './steps/ConfirmStep';
import { DoneStep } from './steps/DoneStep';

const TITLES: Record<BookingStep, string> = {
  service: 'Выберите услугу',
  time: 'Выберите время',
  contacts: 'Ваши контакты',
  confirm: 'Проверьте запись',
  done: 'Готово',
};

const STEP_NO: Record<BookingStep, number> = { service: 1, time: 2, contacts: 3, confirm: 4, done: 4 };

/** Sequential booking bottom sheet: service → time → contacts → confirm → done. */
export function BookingDrawer() {
  const studio = useStudio();
  const flow = useBookingFlow();
  const navigate = useNavigate();
  const vvh = useVisualViewportHeight();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { step } = flow;

  // Move focus to the step title on every step change and scroll to top.
  useEffect(() => {
    if (!step) return;
    bodyRef.current?.scrollTo({ top: 0 });
    const t = setTimeout(() => titleRef.current?.focus({ preventScroll: true }), 50);
    return () => clearTimeout(t);
  }, [step]);

  // Keep focused fields visible above the keyboard.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onFocus = (e: FocusEvent) => {
      const el = e.target as HTMLElement;
      if (el.matches('input, textarea')) setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 250);
    };
    body.addEventListener('focusin', onFocus);
    return () => body.removeEventListener('focusin', onFocus);
  });

  const service = studio.services.find((s) => s.id === flow.serviceId);
  const open = step !== null;
  const PREV: Partial<Record<BookingStep, BookingStep>> = { time: 'service', contacts: 'time', confirm: 'contacts' };
  const back = () => {
    // Walk real history when we pushed it; after a deep link go to the previous step instead of leaving the site.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) navigate(-1);
    else if (step && PREV[step]) flow.go(PREV[step]!, {}, true);
  };

  const subtitle =
    step === 'time' && service
      ? `${service.name} · ${fmtDuration(service.duration_minutes)} · ${formatPrice(service.price_cents, service.price_is_from, studio.currency)}`
      : step === 'contacts' && service && flow.startsAt
        ? `${service.name} · ${fmtDateTime(flow.startsAt, studio.timezone)}`
        : step === 'done'
          ? studio.name
          : `Онлайн-запись · ${studio.name}`;

  const ready = (s: BookingStep) => {
    if (s === 'time') return !!flow.serviceId;
    if (s === 'contacts' || s === 'confirm') return !!flow.serviceId && !!flow.startsAt;
    if (s === 'done') return !!flow.bookingId;
    return true;
  };
  // A step reached without its inputs (old link) starts over at the service list.
  const effective: BookingStep | null = step && ready(step) ? step : step ? 'service' : null;

  return (
    <Drawer open={open} onOpenChange={(o) => !o && flow.close()} showSwipeHandle>
      <DrawerContent
        className="mx-auto w-full max-w-[640px]"
        style={vvh ? ({ '--drawer-content-max-height': `${Math.max(320, vvh - 24)}px` } as React.CSSProperties) : undefined}
      >
        <DrawerHeader>
          <HStack gap={2} vAlign="center">
            {effective && effective !== 'service' && effective !== 'done' ? (
              <IconButton variant="ghost" label="Назад" icon={<ArrowLeft size={20} />} onClick={back} />
            ) : null}
            <DrawerTitle ref={titleRef} tabIndex={-1} className="flex-1 outline-none text-xl">
              {effective ? TITLES[effective] : ''}
            </DrawerTitle>
            {effective && effective !== 'done' ? <Text type="supporting">{STEP_NO[effective]} из 4</Text> : null}
            <IconButton variant="ghost" label="Закрыть" icon={<X size={20} />} onClick={flow.close} />
          </HStack>
          <DrawerDescription>{subtitle}</DrawerDescription>
        </DrawerHeader>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
          {effective === 'service' && <ServiceStep onPick={(id) => flow.go('time', { svc: id, at: null })} />}
          {effective === 'time' && flow.serviceId && (
            <TimeStep
              serviceId={flow.serviceId}
              day={flow.day}
              startsAt={flow.startsAt}
              onDay={(d) => flow.go('time', { day: d }, true)}
              onPick={(at, d) => flow.go('contacts', { at, day: d })}
            />
          )}
          {effective === 'contacts' && <ContactsStep slug={studio.slug} onDone={() => flow.go('confirm')} />}
          {effective === 'confirm' && flow.serviceId && flow.startsAt && (
            <ConfirmStep
              serviceId={flow.serviceId}
              startsAt={flow.startsAt}
              onBooked={(b) => flow.go('done', { bid: b.id }, true)}
              onChangeTime={() => flow.go('time', { at: null })}
              onEditContacts={() => flow.go('contacts')}
            />
          )}
          {effective === 'done' && flow.bookingId && (
            <DoneStep bookingId={flow.bookingId} onClose={flow.close} onOpenMine={() => navigate(studioPath(studio.slug, 'my'), { replace: true })} />
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
