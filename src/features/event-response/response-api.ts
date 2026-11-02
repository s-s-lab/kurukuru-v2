import { z } from 'zod';

import type { PublicEvent } from '../../../functions/events/service';
import type { createResponseRequest } from './response-model';

export type ResponseRequest = ReturnType<typeof createResponseRequest>;

const availabilitySchema = z.object({
  candidateSlotId: z.uuid(),
  mark: z.enum(['best', 'ok', 'maybe', 'ng']),
});

const publicResponseSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  comment: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  availability: z.array(availabilitySchema),
});

const publicEventSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  status: z.enum(['open', 'closed']),
  finalization: z.object({
    date: z.string(),
    startSlot: z.number().int(),
    endSlot: z.number().int(),
  }).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  candidateSlots: z.array(z.object({
    id: z.uuid(),
    date: z.string(),
    slotIndex: z.number().int(),
  })),
  responses: z.array(publicResponseSchema),
});

const createResponseResultSchema = z.object({
  response: publicResponseSchema,
  editToken: z.string().min(1).max(512),
});

const updateResponseResultSchema = z.object({ response: publicResponseSchema });

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string(),
});

type ApiError = z.infer<typeof apiErrorSchema>;

export class ResponseApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(status: number, message: string, details?: ApiError) {
    super(details?.message ?? message);
    this.name = 'ResponseApiError';
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

type CreateResponseOptions = CommonOptions & { idempotencyKey: string };
type UpdateResponseOptions = CommonOptions & { editToken: string };

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
    throw new ResponseApiError(0, safeMessage);
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(body);
    throw new ResponseApiError(response.status, safeMessage, parsed.success ? parsed.data : undefined);
  }

  try {
    return schema.parse(await response.json());
  } catch {
    throw new ResponseApiError(response.status, safeMessage);
  }
}

export async function getPublicEvent(
  eventId: string,
  options: CommonOptions,
): Promise<PublicEvent> {
  return requestJson(
    publicEventSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}`,
    { headers: { accept: 'application/json' } },
    options.fetcher ?? fetch,
    'イベントを読み込めませんでした。時間をおいて再度お試しください。',
  );
}

export async function createParticipantResponse(
  eventId: string,
  request: ResponseRequest,
  options: CreateResponseOptions,
) {
  return requestJson(
    createResponseResultSchema,
    `${base(options.apiBaseUrl)}/events/${eventId}/responses`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.idempotencyKey,
      },
      body: JSON.stringify(request),
    },
    options.fetcher ?? fetch,
    '回答を保存できませんでした。時間をおいて再度お試しください。',
  );
}

export async function updateParticipantResponse(
  responseId: string,
  request: ResponseRequest,
  options: UpdateResponseOptions,
) {
  return requestJson(
    updateResponseResultSchema,
    `${base(options.apiBaseUrl)}/responses/${responseId}`,
    {
      method: 'PATCH',
      headers: {
        authorization: `Bearer ${options.editToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    options.fetcher ?? fetch,
    '回答を保存できませんでした。時間をおいて再度お試しください。',
  );
}
