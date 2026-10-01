import type { BookingStatus } from '@/lib/types';

export const STATUS_META: Record<BookingStatus, { label: string; color: 'blue' | 'orange' | 'green' | 'gray' | 'red' }> = {
  confirmed: { label: 'Ожидается', color: 'blue' },
  arrived: { label: 'Принят', color: 'orange' },
  done: { label: 'Готов', color: 'green' },
  cancelled: { label: 'Отменена', color: 'gray' },
  no_show: { label: 'Неявка', color: 'red' },
};

export const METHOD_LABEL = { cash: 'Наличные', card: 'Карта', transfer: 'Перевод', other: 'Другое' } as const;
