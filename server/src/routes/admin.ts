import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import { deleteBooking, listBookings, updateBookingStatus } from '../db/bookings.js';
import { writeAudit } from '../db/audit.js';
import type { Db } from '../db/index.js';
import type { BookingEvent } from '../types.js';
import { nowIso } from '../lib/time.js';
import {
  adminListQuerySchema,
  bookingStatusUpdateSchema
} from '../lib/validation.js';
import { bookingEvents } from '../services/events.js';
import {
  handleLogin,
  handleLogout,
  requireAdmin,
  sendError
} from '../services/session.js';

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() }).strict();

let sseClients = 0;
const MAX_SSE_CLIENTS = 20;

function noStore(reply: FastifyReply): void {
  reply.header('Cache-Control', 'no-store, max-age=0');
}

export async function registerAdminRoutes(app: FastifyInstance, db: Db): Promise<void> {
  app.post(
    '/api/admin/login',
    {
      bodyLimit: 8 * 1024,
      config: {
        rateLimit: config.rateLimitDisabled
          ? false
          : { max: 20, timeWindow: '15 minutes' }
      }
    },
    async (request, reply) => {
      noStore(reply);
      await handleLogin(db, request, reply);
    }
  );

  app.post(
    '/api/admin/logout',
    { preHandler: requireAdmin(db, { csrf: true }) },
    async (request, reply) => {
      noStore(reply);
      await handleLogout(db, request, reply);
    }
  );

  app.get(
    '/api/admin/session',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      noStore(reply);
      const admin = request.admin!;
      return reply.send({
        user: { id: admin.userId, username: admin.username },
        csrfToken: admin.csrfToken
      });
    }
  );

  app.get(
    '/api/admin/bookings',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      noStore(reply);
      const parsed = adminListQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return sendError(reply, 400, 'invalid_query', 'Некорректные параметры');
      }
      return reply.send(listBookings(db, parsed.data));
    }
  );

  app.patch(
    '/api/admin/bookings/:id',
    {
      bodyLimit: 4 * 1024,
      preHandler: requireAdmin(db, { csrf: true })
    },
    async (request, reply) => {
      noStore(reply);
      const params = idParamsSchema.safeParse(request.params);
      const body = bookingStatusUpdateSchema.safeParse(request.body);

      if (!params.success || !body.success) {
        return sendError(reply, 400, 'invalid_input', 'Некорректные данные');
      }

      const admin = request.admin!;
      const updated = updateBookingStatus(db, params.data.id, body.data.status, nowIso());

      if (!updated) {
        return sendError(reply, 404, 'not_found', 'Заявка не найдена');
      }

      writeAudit(
        db,
        {
          actorId: admin.userId,
          action: 'booking_status_changed',
          entity: 'booking',
          entityId: String(updated.id),
          meta: { status: updated.status }
        },
        nowIso()
      );

      const event: BookingEvent = { type: 'booking.updated', booking: updated };
      bookingEvents.emit('booking', event);

      return reply.send({ ok: true, booking: updated });
    }
  );

  app.delete(
    '/api/admin/bookings/:id',
    { preHandler: requireAdmin(db, { csrf: true }) },
    async (request, reply) => {
      noStore(reply);
      const params = idParamsSchema.safeParse(request.params);
      if (!params.success) {
        return sendError(reply, 400, 'invalid_input', 'Некорректные данные');
      }

      const admin = request.admin!;
      const removed = deleteBooking(db, params.data.id);
      if (!removed) {
        return sendError(reply, 404, 'not_found', 'Заявка не найдена');
      }

      writeAudit(
        db,
        {
          actorId: admin.userId,
          action: 'booking_deleted',
          entity: 'booking',
          entityId: String(params.data.id)
        },
        nowIso()
      );

      const event: BookingEvent = { type: 'booking.deleted', id: params.data.id };
      bookingEvents.emit('booking', event);

      return reply.send({ ok: true });
    }
  );

  app.get(
    '/api/admin/events',
    { preHandler: requireAdmin(db) },
    async (request, reply) => {
      if (sseClients >= MAX_SSE_CLIENTS) {
        return sendError(reply, 503, 'busy', 'Слишком много подключений');
      }

      reply.hijack();
      const res = reply.raw;
      sseClients += 1;

      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Content-Type-Options': 'nosniff'
      });

      res.write('retry: 5000\n\n');
      res.write(`event: ready\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);

      const onBooking = (event: BookingEvent) => {
        if (res.writableEnded) return;
        res.write(`event: booking\ndata: ${JSON.stringify(event)}\n\n`);
      };

      const heartbeat = setInterval(() => {
        if (res.writableEnded) return;
        res.write(`: ping ${Date.now()}\n\n`);
      }, 20_000);

      let stopped = false;
      const cleanup = () => {
        // close and error can both fire; only release the slot once.
        if (stopped) return;
        stopped = true;
        clearInterval(heartbeat);
        bookingEvents.off('booking', onBooking);
        sseClients = Math.max(0, sseClients - 1);
      };

      bookingEvents.on('booking', onBooking);
      res.on('close', cleanup);
      res.on('error', cleanup);

      return reply;
    }
  );
}
