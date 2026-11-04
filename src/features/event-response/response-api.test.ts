import { describe, expect, it, vi } from 'vitest';

import {
  createParticipantResponse,
  getPublicEvent,
  ResponseApiError,
  updateParticipantResponse,
} from './response-api';

const eventId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const publicResponse = {
  id: responseId,
  displayName: '山田',
  comment: '',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  availability: [{ candidateSlotId: slotId, mark: 'ok' as const }],
};
const event = {
  id: eventId,
  title: '11月の定例',
  description: '',
  status: 'open' as const,
  finalization: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }],
  responses: [publicResponse],
};
const request = {
  displayName: '山田',
  comment: '',
  availability: [{ candidateSlotId: slotId, mark: 'ok' as const }],
};

describe('participant response API', () => {
  it('loads and validates a public event', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(event));
    await expect(getPublicEvent(eventId, { apiBaseUrl: '/api/v1/', fetcher })).resolves.toEqual(event);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/events/${eventId}`, { headers: { accept: 'application/json' } });
  });

  it('creates with an idempotency key and returns a validated edit token', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      response: publicResponse,
      editToken: 'opaque-edit-token-value',
    }, { status: 201 }));

    await expect(createParticipantResponse(eventId, request, {
      apiBaseUrl: '/api/v1',
      idempotencyKey: 'response-key-0001',
      fetcher,
    })).resolves.toEqual({ response: publicResponse, editToken: 'opaque-edit-token-value' });

    expect(fetcher).toHaveBeenCalledWith(`/api/v1/events/${eventId}/responses`, expect.objectContaining({
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'response-key-0001',
      },
      body: JSON.stringify(request),
    }));
  });

  it('updates with a bearer token', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ response: publicResponse }));
    await expect(updateParticipantResponse(responseId, request, {
      apiBaseUrl: '/api/v1',
      editToken: 'opaque-edit-token-value',
      fetcher,
    })).resolves.toEqual({ response: publicResponse });
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/responses/${responseId}`, expect.objectContaining({
      method: 'PATCH',
      headers: {
        authorization: 'Bearer opaque-edit-token-value',
        'content-type': 'application/json',
      },
    }));
  });

  it.each([
    ['invalid JSON success', () => new Response('private edit token', { status: 201 })],
    ['invalid success shape', () => Response.json({ response: {}, editToken: 'private edit token' }, { status: 201 })],
  ])('uses a safe message for %s', async (_label, responseFactory) => {
    const fetcher: typeof fetch = async () => responseFactory();
    await expect(createParticipantResponse(eventId, request, {
      apiBaseUrl: '/api/v1', idempotencyKey: 'response-key-0001', fetcher,
    })).rejects.toEqual(expect.objectContaining({
      message: '回答を保存できませんでした。時間をおいて再度お試しください。',
    }));
  });

  it('parses documented errors without exposing an invalid upstream body', async () => {
    const documented: typeof fetch = async () => Response.json({
      code: 'EVENT_CLOSED',
      message: '回答受付は終了しています。',
      requestId: 'request-1',
    }, { status: 409 });
    await expect(getPublicEvent(eventId, { apiBaseUrl: '/api/v1', fetcher: documented }))
      .rejects.toEqual(expect.objectContaining({ status: 409, code: 'EVENT_CLOSED', requestId: 'request-1' }));

    const invalid: typeof fetch = async () => new Response('private proxy detail', { status: 502 });
    const error = await getPublicEvent(eventId, { apiBaseUrl: '/api/v1', fetcher: invalid })
      .catch((value: unknown) => value);
    expect(error).toBeInstanceOf(ResponseApiError);
    expect(error).toMatchObject({
      status: 502,
      message: 'イベントを読み込めませんでした。時間をおいて再度お試しください。',
    });
    expect(String(error)).not.toContain('private proxy detail');
  });
});
