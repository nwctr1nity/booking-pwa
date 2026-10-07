import type { Studio } from '@/lib/types';

/** How the customer-facing texts name the place: «студия», «мойка», «салон»… */
const WORDS = {
  studio: { one: 'студия', to: 'в студию', of: 'студии', resource: 'Место', hasCar: true, arrived: 'Автомобиль принят' },
  wash: { one: 'мойка', to: 'на мойку', of: 'мойки', resource: 'Место', hasCar: true, arrived: 'Автомобиль принят' },
  service: { one: 'автосервис', to: 'в автосервис', of: 'автосервиса', resource: 'Место', hasCar: true, arrived: 'Автомобиль принят' },
  tire: { one: 'шиномонтаж', to: 'на шиномонтаж', of: 'шиномонтажа', resource: 'Место', hasCar: true, arrived: 'Автомобиль принят' },
  // a beauty salon: resources are masters, there is no car
  beauty: { one: 'салон', to: 'в салон', of: 'салона', resource: 'Мастер', hasCar: false, arrived: 'Клиент пришёл' },
} as const;

export type PlaceWords = (typeof WORDS)[keyof typeof WORDS];

export function placeWords(kind: Studio['kind']): PlaceWords {
  return kind === 'wash' || kind === 'service' || kind === 'tire' || kind === 'beauty' ? WORDS[kind] : WORDS.studio;
}

/** Owner cabinet words: what a resource is called and whether bookings carry a car. */
export function ownerWords(kind: Studio['kind']) {
  return kind === 'beauty'
    ? { resource: 'Мастер', resourceLower: 'мастер', newResource: 'Новый мастер', addResource: 'Добавить мастера', blockTitle: 'Закрыть время мастера', blockHint: 'Мастер будет недоступен для записи в это время', blocked: 'Время закрыто', hasCar: false, arrived: 'Клиент пришёл', done: 'Готово', resourcesHint: 'Мастер принимает одного клиента за раз. Выключенный мастер не получает новые записи, существующие остаются.', hoursHint: 'Время, когда салон принимает клиентов. Процедура дольше интервала начинается в нём и продолжается дальше.' }
    : { resource: 'Пост', resourceLower: 'пост', newResource: 'Новый пост', addResource: 'Добавить пост', blockTitle: 'Закрыть пост', blockHint: 'Пост будет недоступен для записи в это время', blocked: 'Пост закрыт', hasCar: true, arrived: 'Автомобиль принят', done: 'Готов к выдаче', resourcesHint: 'Пост — место, где одновременно обслуживается одна машина. Выключенный пост не принимает новые записи, существующие остаются.', hoursHint: 'Время, когда студия принимает машины. Запись на работу дольше интервала начинается в нём и продолжается дальше.' };
}
