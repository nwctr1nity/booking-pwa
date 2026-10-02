export function formatMoney(cents: number, currency = 'RUB', locale = 'ru-RU') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    // ₸, ₽, $ instead of «KZT»: ru-RU only has a symbol for its own currency
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatPrice(cents: number, isFrom: boolean, currency = 'RUB') {
  return `${isFrom ? 'от ' : ''}${formatMoney(cents, currency)}`;
}

/** ₸, ₽, $ — for input units next to an amount */
export function currencySymbol(currency = 'RUB', locale = 'ru-RU') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}
