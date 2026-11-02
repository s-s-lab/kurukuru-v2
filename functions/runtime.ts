import { Pool } from 'pg';

import { createAdminService } from './admin/admin-service';
import { PostgresAdminRepository } from './admin/postgres-admin-repository';
import { createApp } from './app';
import { createResponseService } from './responses/response-service';
import { PostgresResponseRepository } from './responses/postgres-response-repository';
import { createEventService } from './events/event-service';
import { PostgresEventRepository } from './events/postgres-event-repository';
import { PostgresRequestRateLimiter } from './security/rate-limit';
import { generateOpaqueToken, verifyPassword } from './security/secrets';

type RuntimeEnvironment = {
  DATABASE_URL?: string;
  KURUKURU_TOKEN_SECRET?: string;
  KURUKURU_ALLOWED_ORIGINS?: string;
};

type RuntimeDependencies = {
  createPool: (connectionString: string) => Pool;
  verifyAdminPassword: (password: string, encoded: string) => Promise<boolean>;
  generateAdminToken: () => string;
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

  return createApp({ allowedOrigins, eventService, responseService, adminService, rateLimiter });
}
