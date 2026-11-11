import { z } from 'zod';

import type { CreateEventResult } from '../../../functions/events/service';
import type { toCreateEventRequest } from './event-draft';

export type { CreateEventResult } from '../../../functions/events/service';
export type CreateEventRequest = ReturnType<typeof toCreateEventRequest>;
export type CreateEventOptions = {
  apiBaseUrl: string;
  idempotencyKey: string;
  fetcher?: typeof fetch;
};

const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string(),
});

const createEventResultSchema = z.object({
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    description: z.string(),
    duration: z.string(),
    status: z.enum(['open', 'closed']),
    finalization: z.object({ date: z.string(), startSlot: z.number(), endSlot: z.number() }).nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    candidateSlots: z.array(z.object({ id: z.uuid(), date: z.string(), slotIndex: z.number() })),
    responses: z.array(z.object({
      id: z.uuid(),
      displayName: z.string(),
      comment: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      availability: z.array(z.object({
        candidateSlotId: z.uuid(),
        mark: z.enum(['best', 'ok', 'maybe', 'ng']),
      })),
    })),
  }),
  emailVerificationRequired: z.literal(true),
});

type ApiErrorDetails = z.infer<typeof apiErrorSchema>;
const safeErrorMessage = 'イベントを作成できませんでした。時間をおいて再度お試しください。';

export class EventApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(status: number, details?: ApiErrorDetails) {
    super(details?.message ?? safeErrorMessage);
    this.name = 'EventApiError';
    this.status = status;
    this.code = details?.code;
    this.fieldErrors = details?.fieldErrors;
    this.requestId = details?.requestId;
  }
}

export async function createEvent(
  request: CreateEventRequest,
  options: CreateEventOptions,
): Promise<CreateEventResult> {
  const response = await (options.fetcher ?? fetch)(
    `${options.apiBaseUrl.replace(/\/+$/, '')}/events`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.idempotencyKey,
      },
      body: JSON.stringify(request),
    },
  );

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorSchema.safeParse(body);
    throw new EventApiError(response.status, parsed.success ? parsed.data : undefined);
  }

  try {
    return createEventResultSchema.parse(await response.json());
  } catch {
    throw new EventApiError(response.status);
  }
}
