import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { createBooking, findRecentDuplicate } from '../db/bookings.js';
import type { Db } from '../db/index.js';
import { bookingInputSchema } from '../lib/validation.js';
import { emitBookingEvent } from '../services/events.js';

const RETENTION_MS = () => config.bookingRetentionDays * 24 * 60 * 60 * 1000;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function registerPublicRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post(
    '/api/bookings',
    {
      bodyLimit: 16 * 1024,
      config: {
        rateLimit: config.rateLimitDisabled
          ? false
          : { max: 5, timeWindow: '10 minutes' }
      }
    },
    async (request, reply) => {
      const parsed = bookingInputSchema.safeParse(request.body);

      if (!parsed.success) {
        const fields: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = issue.path.join('.') || '_';
          if (!fields[key]) fields[key] = issue.message;
        }
        return reply
          .code(400)
          .send({ error: { code: 'invalid_input', message: 'Проверьте поля формы' }, fields });
      }

      const input = parsed.data;

      // Honeypot triggered: pretend success, store nothing.
      if (input.website.trim().length > 0) {
        request.log.warn({ event: 'booking_honeypot' }, 'Honeypot triggered');
        return reply.code(201).send({ ok: true });
      }

      const now = new Date();
      const duplicateSince = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString();
      const duplicate = findRecentDuplicate(
        db,
        input.phone,
        input.service ?? null,
        duplicateSince
      );

      if (duplicate) {
        return reply.code(201).send({ ok: true });
      }

      const booking = createBooking(db, {
        name: input.name,
        phone: input.phone,
        phoneNormalized: input.phone,
        serviceCategory: input.serviceCategory ?? null,
        service: input.service ?? null,
        preferredDate: input.preferredDate ?? null,
        comment: input.comment ?? null,
        consentAt: now.toISOString(),
        consentVersion: config.consentVersion,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + RETENTION_MS()).toISOString()
      });

      request.log.info({ event: 'booking_created', bookingId: booking.id }, 'Booking created');
      emitBookingEvent({ type: 'booking.created', booking });

      return reply.code(201).send({ ok: true });
    }
  );
}
