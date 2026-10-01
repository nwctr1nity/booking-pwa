import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

export type BookingStep = 'service' | 'time' | 'contacts' | 'confirm' | 'done';
const STEPS: BookingStep[] = ['service', 'time', 'contacts', 'confirm', 'done'];
const KEYS = ['book', 'svc', 'day', 'at', 'bid'] as const;

/**
 * The booking sheet state lives in the URL (?book=step&svc=…&day=…&at=…),
 * so the system Back button walks back through steps and a reload keeps
 * the place. Each forward step pushes a history entry.
 */
export function useBookingFlow() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('book');
  const step = STEPS.includes(raw as BookingStep) ? (raw as BookingStep) : null;

  const state = useMemo(
    () => ({
      step,
      serviceId: params.get('svc'),
      day: params.get('day'),
      startsAt: params.get('at'),
      bookingId: params.get('bid'),
    }),
    [params, step],
  );

  const go = useCallback(
    (next: BookingStep, patch: Partial<Record<'svc' | 'day' | 'at' | 'bid', string | null>> = {}, replace = false) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          p.set('book', next);
          for (const [k, v] of Object.entries(patch)) {
            if (v == null) p.delete(k);
            else p.set(k, v);
          }
          return p;
        },
        { replace },
      );
    },
    [setParams],
  );

  const open = useCallback((serviceId?: string) => (serviceId ? go('time', { svc: serviceId, at: null }) : go('service')), [go]);

  const close = useCallback(() => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const k of KEYS) p.delete(k);
        return p;
      },
      { replace: true },
    );
  }, [setParams]);

  return { ...state, go, open, close };
}
