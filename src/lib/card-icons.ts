import { Camera, Car, Clock, Coffee, Drop, Heart, Medal, Scissors, ShieldCheck, Sparkle, Star, ThumbsUp, Timer, Warehouse, Wrench, type Icon } from '@phosphor-icons/react';

/** Icons available for the three info cards (business.json `info_cards[].icon`). */
import type { CardIconName } from './card-icon-names';

export const CARD_ICONS: Record<CardIconName, { icon: Icon; label: string }> = {
  'shield-check': { icon: ShieldCheck, label: 'Щит (гарантия)' },
  sparkle: { icon: Sparkle, label: 'Блеск (качество)' },
  star: { icon: Star, label: 'Звезда (отзывы)' },
  camera: { icon: Camera, label: 'Камера (фотоотчёт)' },
  coffee: { icon: Coffee, label: 'Кофе (зона ожидания)' },
  timer: { icon: Timer, label: 'Таймер (быстро)' },
  clock: { icon: Clock, label: 'Часы (график)' },
  warehouse: { icon: Warehouse, label: 'Склад (хранение)' },
  wrench: { icon: Wrench, label: 'Ключ (ремонт)' },
  car: { icon: Car, label: 'Машина' },
  drop: { icon: Drop, label: 'Капля (мойка)' },
  medal: { icon: Medal, label: 'Медаль (опыт)' },
  'thumbs-up': { icon: ThumbsUp, label: 'Палец вверх' },
  scissors: { icon: Scissors, label: 'Ножницы (мастера)' },
  heart: { icon: Heart, label: 'Сердце (забота)' },
};

export const cardIcon = (name?: string) => (CARD_ICONS[name as CardIconName] ?? CARD_ICONS.sparkle).icon;
