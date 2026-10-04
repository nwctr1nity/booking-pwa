import type { Studio } from '@/lib/types';

/** How the customer-facing texts name the place: «студия», «мойка», … */
const WORDS = {
  studio: { one: 'студия', to: 'в студию', of: 'студии' },
  wash: { one: 'мойка', to: 'на мойку', of: 'мойки' },
  service: { one: 'автосервис', to: 'в автосервис', of: 'автосервиса' },
  tire: { one: 'шиномонтаж', to: 'на шиномонтаж', of: 'шиномонтажа' },
} as const;

export type PlaceWords = (typeof WORDS)[keyof typeof WORDS];

export function placeWords(kind: Studio['kind']): PlaceWords {
  return kind === 'wash' || kind === 'service' || kind === 'tire' ? WORDS[kind] : WORDS.studio;
}
