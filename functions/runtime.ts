import { Pool } from 'pg';

import { createAdminService } from './admin/admin-service';
import { PostgresAdminRepository } from './admin/postgres-admin-repository';
import { createApp } from './app';
import { createResponseService } from './responses/response-service';
import { PostgresResponseRepository } from './responses/postgres-response-repository';
import { createEventService } from './events/event-service';
import { PostgresEventRepository } from './events/postgres-event-repository';
import { createEmailVerificationService } from './email-verifications/email-verification-service';
import { PostgresEmailVerificationRepository } from './email-verifications/postgres-email-verification-repository';
import { ResendMailer } from './mail/resend-mailer';
import { createNotificationDispatcher } from './notifications/notification-dispatcher';
import { PostgresNotificationRepository } from './notifications/postgres-notification-repository';
import { PostgresRequestRateLimiter } from './security/rate-limit';
import { generateOpaqueToken, verifyPassword } from './security/secrets';

type RuntimeEnvironment = {
  DATABASE_URL?: string;
  KURUKURU_TOKEN_SECRET?: string;
  KURUKURU_ALLOWED_ORIGINS?: string;
  RESEND_API_KEY?: string;
  KURUKURU_MAIL_FROM?: string;
  KURUKURU_PUBLIC_BASE_URL?: string;
  KURUKURU_NOTIFICATION_WORKER_SECRET?: string;
};

type RuntimeDependencies = {
  createPool: (connectionString: string) => Pool;
  verifyAdminPassword: (password: string, encoded: string) => Promise<boolean>;
  generateAdminToken: () => string;
  fetcher: typeof fetch;
};

const defaultDependencies: RuntimeDependencies = {
  createPool: (connectionString) =>
    new Pool({
      connectionString,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      query_timeout: 10_000,
    }),
  verifyAdminPassword: verifyPassword,
  generateAdminToken: generateOpaqueToken,
  fetcher: fetch,
};

export function createRuntimeApp(
  environment: RuntimeEnvironment,
  dependencyOverrides: Partial<RuntimeDependencies> = {},
) {
  if (!environment.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to start Kurukuru API.');
  }

  if (!environment.KURUKURU_TOKEN_SECRET || environment.KURUKURU_TOKEN_SECRET.length < 32) {
    throw new Error('KURUKURU_TOKEN_SECRET must contain at least 32 characters to start Kurukuru API.');
  }

  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const allowedOrigins = [
    ...new Set(
      (environment.KURUKURU_ALLOWED_ORIGINS ?? '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  ];
  const pool = dependencies.createPool(environment.DATABASE_URL);
  const repository = new PostgresEventRepository(pool);
  const eventService = createEventService(repository);
  const rateLimiter = new PostgresRequestRateLimiter(pool);

  const responseService = createResponseService(
    new PostgresResponseRepository(pool),
    environment.KURUKURU_TOKEN_SECRET,
  );
  const adminService = createAdminService(new PostgresAdminRepository(pool), {
    verifyPassword: dependencies.verifyAdminPassword,
    generateToken: dependencies.generateAdminToken,
  });

  const hasCompleteMailConfig = Boolean(
    environment.RESEND_API_KEY
    && environment.KURUKURU_MAIL_FROM
    && environment.KURUKURU_PUBLIC_BASE_URL,
  );
  const mailSender = hasCompleteMailConfig
    ? new ResendMailer({
      apiKey: environment.RESEND_API_KEY!,
      from: environment.KURUKURU_MAIL_FROM!,
      fetcher: dependencies.fetcher,
    })
    : undefined;
  const emailVerificationService = hasCompleteMailConfig
    ? createEmailVerificationService({
      repository: new PostgresEmailVerificationRepository(pool),
      mailSender: mailSender!,
      publicBaseUrl: environment.KURUKURU_PUBLIC_BASE_URL!,
    })
    : undefined;
  const notificationDispatcher = mailSender && environment.KURUKURU_NOTIFICATION_WORKER_SECRET
    ? createNotificationDispatcher({
      repository: new PostgresNotificationRepository(pool),
      mailSender,
      publicBaseUrl: environment.KURUKURU_PUBLIC_BASE_URL!,
    })
    : undefined;

  return createApp({
    allowedOrigins,
    eventService,
    responseService,
    adminService,
    emailVerificationService,
    notificationDispatcher,
    notificationWorkerSecret: environment.KURUKURU_NOTIFICATION_WORKER_SECRET,
    rateLimiter,
  });
}
