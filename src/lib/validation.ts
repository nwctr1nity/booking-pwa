import { z } from 'zod';

export function normalizePhone(raw: string) {
  const plus = raw.trim().startsWith('+') ? '+' : '';
  return plus + raw.replace(/\D/g, '');
}

// Same limits as app_private.core_create_booking.
export const contactsSchema = z.object({
  name: z.string().trim().min(2, 'Укажите имя').max(80, 'Слишком длинное имя'),
  phone: z
    .string()
    .transform(normalizePhone)
    .refine((v) => /^\+?[0-9]{10,15}$/.test(v), 'Телефон: 10–15 цифр'),
  car: z.string().trim().min(2, 'Укажите марку и модель').max(80, 'Слишком длинно'),
  comment: z.string().trim().max(500, 'Не больше 500 символов'),
});

export type Contacts = z.input<typeof contactsSchema>;

export function fieldErrors(result: z.ZodSafeParseResult<unknown>) {
  const out: Record<string, string> = {};
  if (!result.success) {
    for (const issue of result.error.issues) {
      const k = String(issue.path[0] ?? '');
      if (!out[k]) out[k] = issue.message;
    }
  }
  return out;
}
