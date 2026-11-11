import { z } from 'zod';

import type {
  AdminCandidateSlotsRequest,
  AdminEvent,
  AdminEventUpdateRequest,
  AdminFinalizationRequest,
  AdminSessionResult,
} from '../../../functions/admin/service';

const availabilitySchema = z.object({
  candidateSlotId: z.uuid(),
  mark: z.enum(['best', 'ok', 'maybe', 'ng']),
});

const responseSchema = z.object({
  id: z.uuid(),
  displayName: z.string().min(1).max(80),
  comment: z.string().max(1000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  availability: z.array(availabilitySchema),
});

const finalizationSchema = z.object({
  date: z.iso.date(),
  startSlot: z.number().int().min(12).max(59),
  endSlot: z.number().int().min(13).max(60),
}).refine(({ startSlot, endSlot }) => endSlot > startSlot);

const adminEventSchema = z.object({
  id: z.uuid(),
  title: z.string().min(1).max(120),
  description: z.string().max(2000),
  duration: z.string().max(100),
  organizerEmail: z.email().max(254),
  organizerEmailVerified: z.boolean(),
  notifyOnResponse: z.boolean(),
  status: z.enum(['open', 'closed']),
  finalization: finalizationSchema.nullable(),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  candidateSlots: z.array(z.object({
    id: z.uuid(),
    date: z.iso.date(),
    slotIndex: z.number().int().min(12).max(59),
  })),
  responses: z.array(responseSchema),
});

const adminSessionResultSchema = z.object({
  sessionToken: z.string().min(1).max(512),
  expiresAt: z.iso.datetime(),
  event: adminEventSchema,
});

const emailVerificationSendResultSchema = z.object({
  status: z.enum(['sent', 'already-verified']),
});

const emailVerificationResultSchema = z.object({
  eventId: z.uuid(),
  status: z.literal('verified'),
});

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string(),
});

type ApiErrorDetails = z.infer<typeof apiErrorSchema>;

export class AdminApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(status: number, safeMessage: string, details?: ApiErrorDetails) {
    super(details?.message ?? safeMessage);
    this.name = 'AdminApiError';
    this.status = status;
    this.code = details?.code;
    this.fieldErrors = details?.fieldErrors;
    this.requestId = details?.requestId;
  }
}

type CommonOptions = {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
};

type AuthenticatedOptions = CommonOptions & { sessionToken: string };

function base(value: string) {
  return value.replace(/\/+$/, '');
}

async function requestJson<T>(
  schema: z.ZodType<T>,
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  safeMessage: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new AdminApiError(0, safeMessage);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(body);
    throw new AdminApiError(response.status, safeMessage, parsed.success ? parsed.data : undefined);
  }

  try {
    return schema.parse(await response.json());
  } catch {
    throw new AdminApiError(response.status, safeMessage);
  }
}

const loadMessage = '管理情報を読み込めませんでした。時間をおいて再度お試しください。';
const loginMessage = '管理画面を開けませんでした。入力内容を確認して再度お試しください。';
const updateMessage = '変更を保存できませんでした。時間をおいて再度お試しください。';
const statusMessage = '受付状態を変更できませんでした。時間をおいて再度お試しください。';
const scheduleMessage = '日程を変更できませんでした。時間をおいて再度お試しください。';
const deleteMessage = 'イベントを削除できませんでした。時間をおいて再度お試しください。';
const verificationSendMessage = '確認メールを送信できませんでした。時間をおいて再度お試しください。';
const verificationMessage = 'メールアドレスを確認できませんでした。リンクを確認して再度お試しください。';

function authorization(sessionToken: string) {
  return { authorization: `Bearer ${sessionToken}` };
}

export function createAdminSession(
  eventId: string,
  password: string,
  options: CommonOptions,
): Promise<AdminSessionResult> {
  return requestJson(
    adminSessionResultSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/admin/sessions`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password }),
    },
    options.fetcher ?? fetch,
    loginMessage,
  );
}

export function getAdminEvent(
  eventId: string,
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/admin`,
    { headers: { accept: 'application/json', ...authorization(options.sessionToken) } },
    options.fetcher ?? fetch,
    loadMessage,
  );
}

export function updateAdminEvent(
  eventId: string,
  request: AdminEventUpdateRequest,
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}`,
    {
      method: 'PATCH',
      headers: { ...authorization(options.sessionToken), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    options.fetcher ?? fetch,
    updateMessage,
  );
}

function changeStatus(
  eventId: string,
  action: 'close' | 'reopen',
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/${action}`,
    { method: 'POST', headers: authorization(options.sessionToken) },
    options.fetcher ?? fetch,
    statusMessage,
  );
}

export function closeAdminEvent(eventId: string, options: AuthenticatedOptions) {
  return changeStatus(eventId, 'close', options);
}

export function reopenAdminEvent(eventId: string, options: AuthenticatedOptions) {
  return changeStatus(eventId, 'reopen', options);
}

export function replaceAdminCandidateSlots(
  eventId: string,
  request: AdminCandidateSlotsRequest,
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/candidate-slots`,
    {
      method: 'PUT',
      headers: { ...authorization(options.sessionToken), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    options.fetcher ?? fetch,
    scheduleMessage,
  );
}

export function setAdminFinalization(
  eventId: string,
  request: AdminFinalizationRequest,
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/finalization`,
    {
      method: 'POST',
      headers: { ...authorization(options.sessionToken), 'content-type': 'application/json' },
      body: JSON.stringify(request),
    },
    options.fetcher ?? fetch,
    scheduleMessage,
  );
}

export function clearAdminFinalization(
  eventId: string,
  options: AuthenticatedOptions,
): Promise<AdminEvent> {
  return requestJson(
    adminEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/finalization`,
    { method: 'DELETE', headers: authorization(options.sessionToken) },
    options.fetcher ?? fetch,
    scheduleMessage,
  );
}

export function sendAdminEmailVerification(
  eventId: string,
  options: AuthenticatedOptions,
): Promise<{ status: 'sent' | 'already-verified' }> {
  return requestJson(
    emailVerificationSendResultSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/email-verifications`,
    { method: 'POST', headers: authorization(options.sessionToken) },
    options.fetcher ?? fetch,
    verificationSendMessage,
  );
}

export function verifyOrganizerEmail(
  token: string,
  options: CommonOptions,
): Promise<{ eventId: string; status: 'verified' }> {
  return requestJson(
    emailVerificationResultSchema,
    `${base(options.apiBaseUrl)}/email-verifications/${encodeURIComponent(token)}`,
    { headers: { accept: 'application/json' } },
    options.fetcher ?? fetch,
    verificationMessage,
  );
}

export async function deleteAdminEvent(
  eventId: string,
  options: AuthenticatedOptions,
): Promise<void> {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(`${base(options.apiBaseUrl)}/events/${eventId}`, {
      method: 'DELETE', headers: authorization(options.sessionToken),
    });
  } catch {
    throw new AdminApiError(0, deleteMessage);
  }
  if (response.status === 204) return;
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(body);
    throw new AdminApiError(response.status, deleteMessage, parsed.success ? parsed.data : undefined);
  }
  throw new AdminApiError(response.status, deleteMessage);
}
