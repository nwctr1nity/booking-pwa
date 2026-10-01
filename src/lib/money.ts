export function formatMoney(cents: number, currency = 'RUB', locale = 'ru-RU') {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function formatPrice(cents: number, isFrom: boolean, currency = 'RUB') {
  return `${isFrom ? 'от ' : ''}${formatMoney(cents, currency)}`;
}
