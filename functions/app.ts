import { randomUUID, timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@neon/functions';
import { parseTriggerDelivery } from '@neon/functions/triggers';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import {
  AdminAccessDeniedError,
  EventFinalizedError,
  InvalidFinalizationError,
  type AdminService,
} from './admin/service';
import {
  adminCandidateSlotsSchema,
  adminEventUpdateSchema,
  adminFinalizationSchema,
  adminSessionRequestSchema,
} from './admin/validation';
import { IdempotencyConflictError } from './events/postgres-event-repository';
import type { EventService } from './events/service';
import { createEventRequestSchema } from './events/validation';
import { EmailVerificationNotFoundError } from './email-verifications/repository';
import type { EmailVerificationService } from './email-verifications/service';
import { MailDeliveryError } from './mail/resend-mailer';
import type { NotificationDispatcher } from './notifications/service';
import {
  EventNotFoundError,
  EventClosedError,
  InvalidAvailabilityError,
  ResponseNotFoundError,
} from './responses/repository';
import type { ResponseService } from './responses/service';
import { responseRequestSchema } from './responses/validation';
import type { RateLimitRequest, RequestRateLimiter } from './security/rate-limit';

type AppConfig = {
  allowedOrigins: readonly string[];
  eventService?: EventService;
  responseService?: ResponseService;
  adminService?: AdminService;
  emailVerificationService?: EmailVerificationService;
  notificationDispatcher?: NotificationDispatcher;
  notificationWorkerSecret?: string;
  rateLimiter?: RequestRateLimiter;
};

type AppEnvironment = {
  Variables: {
    requestId: string;
  };
};

async function readBodyWithinLimit(
  request: Request,
  maximumBytes: number,
): Promise<{ tooLarge: boolean; text: string }> {
  if (!request.body) {
    return { tooLarge: false, text: '' };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        // Cancellation failures must not replace an already established 413 result.
        await reader.cancel('request body too large').catch(() => undefined);
        return { tooLarge: true, text: '' };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { tooLarge: false, text: new TextDecoder().decode(bytes) };
}

type JsonBodyResult =
  | { input: unknown; error?: never }
  | { error: { code: string; message: string }; status: 400 | 413 };

async function readJsonBody(request: Request, maximumBytes: number): Promise<JsonBodyResult> {
  const tooLarge = {
    error: { code: 'PAYLOAD_TOO_LARGE', message: '送信内容が大きすぎます。' },
    status: 413 as const,
  };
  const contentLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
    return tooLarge;
  }
  try {
    const body = await readBodyWithinLimit(request, maximumBytes);
    return body.tooLarge ? tooLarge : { input: JSON.parse(body.text) as unknown };
  } catch {
    return {
      error: { code: 'INVALID_JSON', message: 'JSON形式が正しくありません。' },
      status: 400,
    };
  }
}

function validationFieldErrors(error: z.ZodError): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? 'request');
    fieldErrors[field] ??= [];
    fieldErrors[field].push(issue.message);
  }
  return fieldErrors;
}

function extractBearerToken(authorization: string | undefined): string | undefined {
  return authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
}

function secretsMatch(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length
    && timingSafeEqual(actualBytes, expectedBytes);
}

export function createApp(config: AppConfig) {
  const app = new Hono<AppEnvironment>();
  const allowedOrigins = new Set(config.allowedOrigins);

  app.use('*', async (context, next) => {
    const requestId = context.req.header('x-request-id') ?? randomUUID();
    const origin = context.req.header('origin');
    context.set('requestId', requestId);
    context.header('x-request-id', requestId);

    if (origin) {
      context.header('vary', 'Origin');
    }
    if (origin && allowedOrigins.has(origin)) {
      context.header('access-control-allow-origin', origin);
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

  app.post('/api/v1/events', async (context) => {
    const requestId = context.get('requestId');
    const idempotencyKey = context.req.header('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return context.json(
        {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: '16〜128文字のIdempotency-Keyヘッダーが必要です。',
          requestId,
        },
        400,
      );
    }

    if (config.rateLimiter) {
      const decision = await config.rateLimiter.check({
        scope: 'create-event-global',
        subject: 'all',
        limit: 60,
        windowSeconds: 60,
      });
      if (!decision.allowed) {
        context.header('retry-after', String(decision.retryAfterSeconds));
        return context.json(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'リクエスト回数が上限を超えました。時間をおいて再試行してください。',
            requestId,
          },
          429,
        );
      }
    }

    const body = await readJsonBody(context.req.raw, 64 * 1024);
    if (body.error) {
      return context.json({ ...body.error, requestId }, body.status);
    }
    const parsed = createEventRequestSchema.safeParse(body.input);
    if (!parsed.success) {
      const fieldErrors = validationFieldErrors(parsed.error);
      return context.json(
        {
          code: 'VALIDATION_ERROR',
          message: '入力内容を確認してください。',
          fieldErrors,
          requestId,
        },
        422,
      );
    }

    if (config.rateLimiter) {
      const decision = await config.rateLimiter.check({
        scope: 'create-event-email',
        subject: parsed.data.organizerEmail,
        limit: 10,
        windowSeconds: 600,
      });
      if (!decision.allowed) {
        context.header('retry-after', String(decision.retryAfterSeconds));
        return context.json(
          {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'リクエスト回数が上限を超えました。時間をおいて再試行してください。',
            requestId,
          },
          429,
        );
      }
    }

    if (!config.eventService) {
      return context.json(
        { code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId },
        503,
      );
    }

    const result = await config.eventService.createEvent({
      idempotencyKey,
      request: parsed.data,
    });
    return context.json(result, 201);
  });

  app.get('/api/v1/events/:eventId', async (context) => {
    const requestId = context.get('requestId');
    if (!config.eventService) {
      return context.json(
        { code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId },
        503,
      );
    }

    const eventId = context.req.param('eventId').toLowerCase();
    if (!z.uuid().safeParse(eventId).success) {
      return context.json(
        { code: 'EVENT_NOT_FOUND', message: 'イベントが見つかりません。', requestId },
        404,
      );
    }

    const event = await config.eventService.getPublicEvent(eventId);
    if (!event) {
      return context.json(
        { code: 'EVENT_NOT_FOUND', message: 'イベントが見つかりません。', requestId },
        404,
      );
    }

    return context.json(event);
  });

  async function enforceRateLimit(context: Context<AppEnvironment>, request: RateLimitRequest) {
    if (!config.rateLimiter) return;
    const decision = await config.rateLimiter.check(request);
    if (!decision.allowed) {
      context.header('retry-after', String(decision.retryAfterSeconds));
      return context.json({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'リクエスト回数が上限を超えました。時間をおいて再試行してください。',
        requestId: context.get('requestId'),
      }, 429);
    }
  }

  async function readResponseRequest(context: Context<AppEnvironment>) {
    const requestId = context.get('requestId');
    const body = await readJsonBody(context.req.raw, 128 * 1024);
    if (body.error) {
      return { error: context.json({ ...body.error, requestId }, body.status) };
    }
    const parsed = responseRequestSchema.safeParse(body.input);
    if (!parsed.success) {
      return { error: context.json({
        code: 'VALIDATION_ERROR',
        message: '入力内容を確認してください。',
        fieldErrors: validationFieldErrors(parsed.error),
        requestId,
      }, 422) };
    }
    return { request: parsed.data };
  }

  async function dispatchPendingNotifications() {
    if (!config.notificationDispatcher) return;
    try {
      await config.notificationDispatcher.drain(10);
    } catch (error) {
      console.error('Failed to dispatch pending response notifications.', error);
    }
  }

  app.post('/api/v1/events/:eventId/responses', async (context) => {
    const requestId = context.get('requestId');
    const idempotencyKey = context.req.header('idempotency-key')?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      return context.json({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '16〜128文字のIdempotency-Keyヘッダーが必要です。',
        requestId,
      }, 400);
    }
    const eventId = context.req.param('eventId').toLowerCase();
    if (!z.uuid().safeParse(eventId).success) throw new EventNotFoundError();
    const limited = await enforceRateLimit(context, {
      scope: 'create-response-global', subject: 'all', limit: 300, windowSeconds: 60,
    }) ?? await enforceRateLimit(context, {
      scope: 'create-response-event', subject: eventId, limit: 120, windowSeconds: 600,
    });
    if (limited) return limited;
    const parsed = await readResponseRequest(context);
    if (parsed.error) return parsed.error;
    if (!config.responseService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    const result = await config.responseService.createResponse({
      eventId,
      idempotencyKey,
      request: parsed.request,
    });
    waitUntil(dispatchPendingNotifications());
    return context.json(result, 201);
  });

  app.patch('/api/v1/responses/:responseId', async (context) => {
    const requestId = context.get('requestId');
    const responseId = context.req.param('responseId').toLowerCase();
    const editToken = extractBearerToken(context.req.header('authorization'));
    if (!z.uuid().safeParse(responseId).success || !editToken) throw new ResponseNotFoundError();
    const limited = await enforceRateLimit(context, {
      scope: 'update-response-global', subject: 'all', limit: 300, windowSeconds: 60,
    }) ?? await enforceRateLimit(context, {
      scope: 'update-response-id', subject: responseId, limit: 60, windowSeconds: 600,
    });
    if (limited) return limited;
    const parsed = await readResponseRequest(context);
    if (parsed.error) return parsed.error;
    if (!config.responseService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    const result = await config.responseService.updateResponse({
      responseId,
      editToken,
      request: parsed.request,
    });
    waitUntil(dispatchPendingNotifications());
    return context.json(result, 200);
  });

  app.patch('/api/v1/events/:eventId/responses/:responseId', async (context) => {
    const requestId = context.get('requestId');
    const eventId = context.req.param('eventId').toLowerCase();
    const responseId = context.req.param('responseId').toLowerCase();
    if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(responseId).success) {
      throw new ResponseNotFoundError();
    }
    const limited = await enforceRateLimit(context, {
      scope: 'update-response-global', subject: 'all', limit: 300, windowSeconds: 60,
    }) ?? await enforceRateLimit(context, {
      scope: 'update-response-id', subject: responseId, limit: 60, windowSeconds: 600,
    });
    if (limited) return limited;
    const parsed = await readResponseRequest(context);
    if (parsed.error) return parsed.error;
    if (!config.responseService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    const result = await config.responseService.updatePublicResponse({
      eventId,
      responseId,
      request: parsed.request,
    });
    waitUntil(dispatchPendingNotifications());
    return context.json(result, 200);
  });

  function readAdminAccess(context: Context<AppEnvironment>) {
    const rawEventId = context.req.param('eventId');
    const sessionToken = extractBearerToken(context.req.header('authorization'));
    if (!rawEventId || !sessionToken) {
      throw new AdminAccessDeniedError();
    }
    const eventId = rawEventId.toLowerCase();
    if (!z.uuid().safeParse(eventId).success) throw new AdminAccessDeniedError();
    return { eventId, sessionToken };
  }

  async function enforceAdminOperationLimits(
    context: Context<AppEnvironment>,
    eventId: string,
  ) {
    return await enforceRateLimit(context, {
      scope: 'admin-operation-global', subject: 'all', limit: 300, windowSeconds: 60,
    }) ?? await enforceRateLimit(context, {
      scope: 'admin-operation-event', subject: eventId, limit: 120, windowSeconds: 600,
    });
  }

  function preventAdminResponseCaching(context: Context<AppEnvironment>) {
    context.header('cache-control', 'no-store');
  }

  app.post('/api/v1/events/:eventId/admin/sessions', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const eventId = context.req.param('eventId').toLowerCase();
    if (!z.uuid().safeParse(eventId).success) throw new AdminAccessDeniedError();
    const limited = await enforceRateLimit(context, {
      scope: 'create-admin-session-global', subject: 'all', limit: 60, windowSeconds: 60,
    }) ?? await enforceRateLimit(context, {
      scope: 'create-admin-session-event', subject: eventId, limit: 10, windowSeconds: 600,
    });
    if (limited) return limited;

    const body = await readJsonBody(context.req.raw, 16 * 1024);
    if (body.error) return context.json({ ...body.error, requestId }, body.status);
    const parsed = adminSessionRequestSchema.safeParse(body.input);
    if (!parsed.success) {
      return context.json({
        code: 'VALIDATION_ERROR',
        message: '入力内容を確認してください。',
        fieldErrors: validationFieldErrors(parsed.error),
        requestId,
      }, 422);
    }
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.createSession({
      eventId,
      password: parsed.data.password,
    }), 201);
  });

  app.get('/api/v1/events/:eventId/admin', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.getEvent(access));
  });

  app.post('/api/v1/events/:eventId/email-verifications', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId)
      ?? await enforceRateLimit(context, {
        scope: 'send-email-verification-global', subject: 'all', limit: 60, windowSeconds: 60,
      })
      ?? await enforceRateLimit(context, {
        scope: 'send-email-verification-event', subject: access.eventId, limit: 5, windowSeconds: 600,
      });
    if (limited) return limited;
    if (!config.emailVerificationService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    const result = await config.emailVerificationService.send(access);
    return context.json(result, result.status === 'sent' ? 202 : 200);
  });

  app.get('/api/v1/email-verifications/:token', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const token = context.req.param('token');
    if (!token || token.length < 16 || token.length > 512) {
      throw new EmailVerificationNotFoundError();
    }
    if (!config.emailVerificationService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.emailVerificationService.verify(token));
  });

  app.post('/api/v1/internal/notifications/drain', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    if (!config.notificationDispatcher || !config.notificationWorkerSecret) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    const suppliedSecret = extractBearerToken(context.req.header('authorization'));
    if (!secretsMatch(suppliedSecret, config.notificationWorkerSecret)) {
      return context.json({ code: 'NOT_FOUND', message: '指定されたAPIは見つかりません。', requestId }, 404);
    }
    return context.json(await config.notificationDispatcher.drain(10));
  });

  app.post('/api/v1/internal/notifications/drain-trigger', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    if (!config.notificationDispatcher) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    let payload: unknown;
    try {
      payload = await context.req.json();
    } catch {
      return context.json({ code: 'NOT_FOUND', message: '指定されたAPIは見つかりません。', requestId }, 404);
    }
    // Neon may provide Request from a different runtime realm. Passing the
    // already parsed values avoids relying on cross-realm instanceof checks.
    const parsed = parseTriggerDelivery({ headers: context.req.raw.headers, body: payload });
    if (!parsed.ok || parsed.invocation.type !== 'schedule') {
      return context.json({ code: 'NOT_FOUND', message: '指定されたAPIは見つかりません。', requestId }, 404);
    }
    return context.json(await config.notificationDispatcher.drain(10));
  });

  app.patch('/api/v1/events/:eventId', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    const body = await readJsonBody(context.req.raw, 16 * 1024);
    if (body.error) return context.json({ ...body.error, requestId }, body.status);
    const parsed = adminEventUpdateSchema.safeParse(body.input);
    if (!parsed.success) {
      return context.json({
        code: 'VALIDATION_ERROR',
        message: '入力内容を確認してください。',
        fieldErrors: validationFieldErrors(parsed.error),
        requestId,
      }, 422);
    }
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.updateEvent({ ...access, request: parsed.data }));
  });

  async function changeEventStatus(
    context: Context<AppEnvironment>,
    action: 'closeEvent' | 'reopenEvent',
  ) {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService[action](access));
  }

  app.post('/api/v1/events/:eventId/close', (context) =>
    changeEventStatus(context, 'closeEvent'));
  app.post('/api/v1/events/:eventId/reopen', (context) =>
    changeEventStatus(context, 'reopenEvent'));

  app.put('/api/v1/events/:eventId/candidate-slots', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    const body = await readJsonBody(context.req.raw, 16 * 1024);
    if (body.error) return context.json({ ...body.error, requestId }, body.status);
    const parsed = adminCandidateSlotsSchema.safeParse(body.input);
    if (!parsed.success) {
      return context.json({
        code: 'VALIDATION_ERROR',
        message: '入力内容を確認してください。',
        fieldErrors: validationFieldErrors(parsed.error),
        requestId,
      }, 422);
    }
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.replaceCandidateSlots({
      ...access,
      request: parsed.data,
    }));
  });

  app.post('/api/v1/events/:eventId/finalization', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    const body = await readJsonBody(context.req.raw, 16 * 1024);
    if (body.error) return context.json({ ...body.error, requestId }, body.status);
    const parsed = adminFinalizationSchema.safeParse(body.input);
    if (!parsed.success) {
      return context.json({
        code: 'VALIDATION_ERROR',
        message: '入力内容を確認してください。',
        fieldErrors: validationFieldErrors(parsed.error),
        requestId,
      }, 422);
    }
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.setFinalization({
      ...access,
      request: parsed.data,
    }));
  });

  app.delete('/api/v1/events/:eventId/finalization', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    return context.json(await config.adminService.clearFinalization(access));
  });

  app.delete('/api/v1/events/:eventId', async (context) => {
    preventAdminResponseCaching(context);
    const requestId = context.get('requestId');
    const access = readAdminAccess(context);
    const limited = await enforceAdminOperationLimits(context, access.eventId);
    if (limited) return limited;
    if (!config.adminService) {
      return context.json({ code: 'SERVICE_UNAVAILABLE', message: '現在この機能を利用できません。', requestId }, 503);
    }
    await config.adminService.deleteEvent(access);
    return context.body(null, 204);
  });

  app.onError((error, context) => {
    const requestId = context.get('requestId') ?? randomUUID();
    if (error instanceof IdempotencyConflictError) {
      return context.json(
        {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'このIdempotency-Keyは別のリクエストで使用済みです。',
          requestId,
        },
        409,
      );
    }

    if (error instanceof EventNotFoundError) {
      return context.json({ code: 'EVENT_NOT_FOUND', message: 'イベントが見つかりません。', requestId }, 404);
    }
    if (error instanceof EventClosedError) {
      return context.json({ code: 'EVENT_CLOSED', message: 'このイベントは回答の受付を停止しています。', requestId }, 409);
    }
    if (error instanceof InvalidAvailabilityError) {
      const message = 'イベントの全候補枠に重複なく回答してください。';
      return context.json({ code: 'INVALID_AVAILABILITY', message, fieldErrors: { availability: [message] }, requestId }, 422);
    }
    if (error instanceof ResponseNotFoundError) {
      return context.json({ code: 'RESPONSE_NOT_FOUND', message: '回答が見つかりません。', requestId }, 404);
    }
    if (error instanceof AdminAccessDeniedError) {
      return context.json({ code: 'ADMIN_ACCESS_DENIED', message: '管理画面へアクセスできません。', requestId }, 404);
    }
    if (error instanceof EmailVerificationNotFoundError) {
      return context.json({
        code: 'EMAIL_VERIFICATION_NOT_FOUND',
        message: '確認リンクが無効か、有効期限が切れています。',
        requestId,
      }, 404);
    }
    if (error instanceof MailDeliveryError) {
      return context.json({
        code: 'EMAIL_DELIVERY_FAILED',
        message: '確認メールを送信できませんでした。時間をおいて再試行してください。',
        requestId,
      }, 502);
    }
    if (error instanceof EventFinalizedError) {
      return context.json({
        code: 'EVENT_FINALIZED',
        message: '確定済みの候補枠は削除できません。先に日時確定を解除してください。',
        requestId,
      }, 409);
    }
    if (error instanceof InvalidFinalizationError) {
      const message = '確定日時には連続した候補枠を指定してください。';
      return context.json({
        code: 'INVALID_FINALIZATION',
        message,
        fieldErrors: { finalization: [message] },
        requestId,
      }, 422);
    }

    console.error({
      requestId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    return context.json(
      {
        code: 'INTERNAL_ERROR',
        message: '処理中にエラーが発生しました。時間をおいて再試行してください。',
        requestId,
      },
      500,
    );
  });

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

