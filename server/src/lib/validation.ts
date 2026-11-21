import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { z } from 'zod';
import { addDaysToIsoDate, isRealIsoDate, todayInSalonTimeZone } from './time.js';

// Control characters except \t, \n, \r. Used to reject log-injection and
// terminal escape characters in user input.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

/** Category IDs that must never be accepted by the online booking form. */
export const MEDICAL_CATEGORY_IDS = new Set(['cosmetology', 'traumatology']);

/** Categories the online form may submit. Keep in sync with public/js/data.js. */
export const BOOKING_CATEGORY_IDS = [
  'manicure',
  'massage',
  'brows',
  'coloring',
  'hair',
  'piercing',
  'reconstruction',
  'lashes',
  'tattoo',
  'makeup',
  'pedicure'
] as const;

export function normalizeRuPhone(value: string): string | null {
  try {
    const parsed = parsePhoneNumberFromString(value, 'RU');
    if (!parsed || !parsed.isValid() || parsed.country !== 'RU') return null;
    return parsed.number;
  } catch {
    return null;
  }
}

function textField(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\s+/g, ' ').trim())
    .pipe(
      z
        .string()
        .min(min)
        .max(max)
        .refine((value) => !CONTROL_CHARS.test(value), 'Недопустимые символы')
    );
}

const optionalText = (max: number) =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) => {
      if (value === null || value === undefined) return null;
      const normalized = value.replace(/\r\n/g, '\n').trim();
      return normalized.length ? normalized : null;
    })
    .superRefine((value, ctx) => {
      if (value === null) return;
      if (value.length > max) {
        ctx.addIssue({ code: 'custom', message: `Не длиннее ${max} символов` });
      }
      if (CONTROL_CHARS.test(value)) {
        ctx.addIssue({ code: 'custom', message: 'Недопустимые символы' });
      }
    })
    .optional();

const phoneField = z
  .string()
  .min(1, 'Укажите телефон')
  .max(32, 'Слишком длинный номер')
  .superRefine((value, ctx) => {
    if (!normalizeRuPhone(value)) {
      ctx.addIssue({ code: 'custom', message: 'Укажите корректный российский номер' });
    }
  })
  .transform((value) => normalizeRuPhone(value) as string);

const preferredDateField = z
  .union([z.string(), z.null(), z.undefined()])
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  })
  .superRefine((value, ctx) => {
    if (value === null) return;
    if (!isRealIsoDate(value)) {
      ctx.addIssue({ code: 'custom', message: 'Некорректная дата' });
      return;
    }
    const today = todayInSalonTimeZone();
    const latest = addDaysToIsoDate(today, 365);
    if (value < today) {
      ctx.addIssue({ code: 'custom', message: 'Дата уже прошла' });
    } else if (value > latest) {
      ctx.addIssue({ code: 'custom', message: 'Дата слишком далеко' });
    }
  })
  .optional();

export const bookingInputSchema = z
  .object({
    name: textField(2, 80),
    phone: phoneField,
    serviceCategory: z
      .union([z.string(), z.null(), z.undefined()])
      .transform((value) => (value && value.trim() ? value.trim() : null))
      .superRefine((value, ctx) => {
        if (value === null) return;
        if (MEDICAL_CATEGORY_IDS.has(value)) {
          ctx.addIssue({
            code: 'custom',
            message: 'Медицинские услуги — только запись по телефону или на месте'
          });
          return;
        }
        if (!(BOOKING_CATEGORY_IDS as readonly string[]).includes(value)) {
          ctx.addIssue({ code: 'custom', message: 'Неизвестное направление' });
        }
      })
      .optional(),
    service: optionalText(200),
    preferredDate: preferredDateField,
    comment: optionalText(1000),
    consent: z
      .boolean()
      .refine((value) => value === true, {
        message: 'Нужно согласие на обработку персональных данных'
      }),
    // Honeypot: must stay empty. Real users never see this field.
    website: z.string().max(500).optional().default('')
  })
  .strict();

export type BookingInput = z.output<typeof bookingInputSchema>;

export const adminLoginSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_.-]+$/, 'Недопустимое имя пользователя'),
    password: z.string().min(1).max(200)
  })
  .strict();

export const bookingStatusSchema = z.enum([
  'new',
  'contacted',
  'confirmed',
  'completed',
  'cancelled'
]);

export const bookingStatusUpdateSchema = z
  .object({
    status: bookingStatusSchema
  })
  .strict();

export const adminListQuerySchema = z
  .object({
    status: bookingStatusSchema.optional(),
    q: z.string().max(100).optional(),
    beforeId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(30)
  })
  .strict();

export type AdminListQuery = z.output<typeof adminListQuerySchema>;
