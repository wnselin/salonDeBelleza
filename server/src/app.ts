import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import type { Db } from './db/index.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerPublicRoutes } from './routes/public.js';

/**
 * SHA-256 of the JSON-LD data block in public/index.html.
 * Update it whenever that block changes: strict CSP does not allow inline
 * scripts, and JSON-LD is treated as an inline script by browsers.
 */
const JSON_LD_HASH =
  "'sha256-eVVKEF/BLld36+gmQOAkM0g2eOsHNUmF4vgJeT24jEc='";

export interface BuildAppOptions {
  logger?: boolean;
}

export async function buildApp(db: Db, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: config.trustProxy,
    bodyLimit: 64 * 1024,
    requestTimeout: 20_000,
    logger:
      options.logger === false || config.isTest
        ? false
        : {
            level: config.logLevel,
            serializers: {
              // Never log query strings or headers: they can contain personal data.
              req(request) {
                return {
                  method: request.method,
                  url: request.url.split('?')[0],
                  remoteAddress: request.ip
                };
              },
              res(reply) {
                return { statusCode: reply.statusCode };
              }
            }
          }
  });

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", JSON_LD_HASH],
        styleSrc: ["'self'"],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction
      ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
      : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  });

  await app.register(cookie);
  await app.register(rateLimit, {
    global: false,
    // The plugin throws whatever this returns, so it must be a real Error with a
    // statusCode; otherwise the global error handler maps it to 500.
    errorResponseBuilder: (_request, context) => {
      const error = new Error('Rate limit exceeded') as Error & {
        statusCode: number;
        code: string;
      };
      error.statusCode = context.statusCode;
      error.code = 'too_many_requests';
      return error;
    }
  });

  await registerPublicRoutes(app, db);
  await registerAdminRoutes(app, db);

  await app.register(fastifyStatic, {
    root: config.publicDir,
    prefix: '/',
    index: ['index.html'],
    setHeaders(reply, filePath) {
      if (filePath.endsWith('.html')) {
        reply.header('Cache-Control', 'no-cache');
      } else if (/\/(assets|css|js)\//.test(filePath)) {
        reply.header('Cache-Control', 'public, max-age=3600');
      }
    }
  });

  app.get('/admin', async (_request, reply) => reply.redirect('/admin/', 308));

  app.get('/admin/', async (_request, reply) => {
    reply.header('Cache-Control', 'no-cache');
    return reply.sendFile('admin/index.html');
  });

  app.get('/robots.txt', async (_request, reply) => {
    reply.type('text/plain; charset=utf-8');
    return 'User-agent: *\nDisallow: /admin\nDisallow: /api/\n';
  });

  app.get('/healthz', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { ok: true };
  });

  app.get('/readyz', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1 AS ok').get();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  app.addHook('onSend', async (request, reply, payload) => {
    const path = request.url.split('?')[0] ?? '';
    if (path === '/admin' || path.startsWith('/admin/') || path.startsWith('/api/')) {
      reply.header('X-Robots-Tag', 'noindex, nofollow');
    }
    if (path.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply
        .code(404)
        .send({ error: { code: 'not_found', message: 'Не найдено' } });
    }
    return reply.code(404).type('text/plain; charset=utf-8').send('Не найдено');
  });

  app.setErrorHandler(async (error, request, reply) => {
    const err = error as { statusCode?: number; code?: string };
    const status =
      typeof err.statusCode === 'number' && err.statusCode >= 400
        ? err.statusCode
        : 500;

    if (status >= 500) {
      request.log.error({ err: error }, 'Request failed');
    } else if (status !== 429) {
      request.log.warn({ statusCode: status, code: err.code }, 'Request rejected');
    }

    if (reply.sent) return;

    const message =
      status === 429
        ? 'Слишком много запросов, попробуйте позже'
        : status >= 500
          ? 'Внутренняя ошибка сервера'
          : 'Запрос отклонён';

    return reply
      .code(status)
      .send({ error: { code: status >= 500 ? 'internal_error' : 'request_rejected', message } });
  });

  return app;
}
