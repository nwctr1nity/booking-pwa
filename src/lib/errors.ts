export class ApiError extends Error {
  code: string;
  hint?: string | null;
  status?: number;
  constructor(code: string, hint?: string | null, status?: number) {
    super(code);
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

const messages: Record<string, string> = {
  slot_taken: 'Это время только что заняли. Выберите другое.',
  slot_unavailable: 'На это время записаться нельзя. Выберите другое.',
  service_unavailable: 'Услуга сейчас недоступна для записи.',
  invalid_input: 'Проверьте введённые данные.',
  idempotency_conflict: 'Запрос уже отправлялся с другими данными. Обновите страницу.',
  rate_limited: 'Слишком много попыток. Подождите несколько минут.',
  tenant_not_found: 'Студия не найдена или ссылка устарела.',
  booking_not_found: 'Запись не найдена.',
  cancel_deadline_passed: 'Отменить онлайн уже нельзя. Позвоните в студию.',
  cannot_cancel: 'Эту запись нельзя отменить онлайн.',
  cannot_subscribe: 'Напоминание можно включить только для активной записи.',
  version_conflict: 'Запись изменили в другом окне. Обновите данные.',
  cannot_reschedule: 'Перенести можно только подтверждённую запись.',
  invalid_transition: 'Такой смены статуса нет.',
  refund_exceeds_paid: 'Возврат больше, чем оплачено по записи.',
  forbidden: 'Нет доступа к этой студии.',
  not_found: 'Не найдено.',
  network: 'Нет соединения. Проверьте интернет и попробуйте ещё раз.',
  invalid_credentials: 'Неверная почта или пароль.',
  upload_failed: 'Не удалось загрузить фото.',
  upload_type: 'Подходят фото JPEG, PNG, WebP или AVIF.',
  upload_too_big: 'Фото больше 8 МБ даже после сжатия.',
  push_denied: 'Уведомления запрещены в настройках браузера.',
  sw_unavailable: 'Приложение ещё не готово к уведомлениям. Обновите страницу.',
};

const fieldNames: Record<string, string> = {
  name: 'имя',
  phone: 'телефон',
  car: 'автомобиль',
  comment: 'комментарий',
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'invalid_input' && e.hint && fieldNames[e.hint]) return `Проверьте поле «${fieldNames[e.hint]}».`;
    return messages[e.code] ?? 'Что-то пошло не так. Попробуйте ещё раз.';
  }
  if (e instanceof TypeError) return messages.network!;
  return 'Что-то пошло не так. Попробуйте ещё раз.';
}
