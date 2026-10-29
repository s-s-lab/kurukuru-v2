import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';

type AppConfig = {
  allowedOrigins: readonly string[];
};

type AppEnvironment = {
  Variables: {
    requestId: string;
  };
};

export function createApp(config: AppConfig) {
  const app = new Hono<AppEnvironment>();
  const allowedOrigins = new Set(config.allowedOrigins);

  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id') ?? randomUUID();
    const origin = context.req.header('origin');
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);

    if (origin && allowedOrigins.has(origin)) {
      context.header('access-control-allow-origin', origin);
      context.header('vary', 'Origin');
      context.header('access-control-allow-headers', 'content-type, idempotency-key, authorization');
      context.header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    }

    if (context.req.method === 'OPTIONS') {
      return context.body(null, 204);
    }

    await next();
  });

  app.get('/api/v1/health', (context) =>
    context.json({ status: 'ok', service: 'kurukuru-api' }),
  );

  app.notFound((context) =>
    context.json(
      {
        code: 'NOT_FOUND',
        message: '指定されたAPIは見つかりません。',
        requestId: context.get('requestId'),
      },
      404,
    ),
  );

  return app;
}

