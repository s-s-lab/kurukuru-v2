import { describe, expect, it } from 'vitest';

import { createEvent, EventApiError, type CreateEventRequest } from './event-api';

const request: CreateEventRequest = {
  title: '打ち合わせ',
  description: '',
  duration: '1時間程度',
  organizerEmail: 'organizer@example.com',
  adminPassword: 'password',
  notifyOnResponse: true,
  candidateSlots: [{ date: '2026-11-04', slotIndexes: [26] }],
};
const options = {
  apiBaseUrl: 'https://api.example.test/api/v1///',
  idempotencyKey: 'event-create-00000001',
};

describe('event creation API client', () => {
  it('posts the JSON request with its idempotency key to the normalized API base', async () => {
    const fetchCalls: Array<{ url: string; method?: string; headers: unknown; body: unknown }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      fetchCalls.push({ url: String(input), method: init?.method, headers: init?.headers, body: init?.body });
      return Response.json({
        event: {
          id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
          title: '打ち合わせ', description: '', duration: '1時間程度', status: 'open', finalization: null,
          createdAt: '2026-10-29T07:00:00.000Z', updatedAt: '2026-10-29T07:00:00.000Z',
          candidateSlots: [{
            id: '150da5e0-f923-492c-be9b-263bf5af58fc', date: '2026-11-04', slotIndex: 26,
          }],
          responses: [],
        },
        emailVerificationRequired: true,
      }, { status: 201 });
    };

    const result = await createEvent(request, { ...options, fetcher });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      url: 'https://api.example.test/api/v1/events',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'event-create-00000001',
      },
    });
    expect(JSON.parse(fetchCalls[0].body as string)).toEqual({
      title: '打ち合わせ', description: '', duration: '1時間程度', organizerEmail: 'organizer@example.com',
      adminPassword: 'password', notifyOnResponse: true,
      candidateSlots: [{ date: '2026-11-04', slotIndexes: [26] }],
    });
    expect(result.event.id).toBe('9bed1489-b31f-4b6d-8dcb-e8d95109f98c');
    expect(result.emailVerificationRequired).toBe(true);
  });

  it('exposes documented validation error fields without retaining other upstream fields', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      code: 'VALIDATION_ERROR', message: '入力内容を確認してください。',
      fieldErrors: { title: ['イベント名を入力してください。'] }, requestId: 'request-422',
      debug: 'private upstream detail',
    }, { status: 422 });

    const error = await createEvent(request, { ...options, fetcher }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(EventApiError);
    expect(error).toMatchObject({
      status: 422, code: 'VALIDATION_ERROR', message: '入力内容を確認してください。',
      fieldErrors: { title: ['イベント名を入力してください。'] }, requestId: 'request-422',
    });
    expect(JSON.stringify(error)).not.toContain('private upstream detail');
  });

  it.each([
    ['non-JSON', () => new Response('<html>private proxy detail</html>', { status: 502 })],
    ['invalid error fields', () => Response.json({
      code: 502, message: { detail: 'private proxy detail' }, requestId: [],
    }, { status: 502 })],
  ])('returns a safe generic error for %s upstream errors', async (_name, response) => {
    const fetcher: typeof fetch = async () => response();

    const error = await createEvent(request, { ...options, fetcher }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(EventApiError);
    expect(error).toMatchObject({ status: 502, message: expect.any(String) });
    expect(String(error)).not.toContain('private proxy detail');
    expect(JSON.stringify(error)).not.toContain('private proxy detail');
  });

  it('does not expose malformed successful JSON through parser errors', async () => {
    const fetcher: typeof fetch = async () => new Response('private invalid JSON', { status: 201 });

    const error = await createEvent(request, { ...options, fetcher }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(EventApiError);
    expect(String(error)).not.toContain('private invalid JSON');
  });

  it.each([
    ['missing event', {}],
    ['missing ID', { event: {} }],
    ['numeric ID', { event: { id: 123 } }],
    ['invalid UUID', { event: { id: 'private invalid event ID' } }],
  ])('rejects structurally invalid successful JSON: %s', async (_name, payload) => {
    const fetcher: typeof fetch = async () => Response.json({ ...payload, debug: 'private success detail' }, { status: 201 });

    const error = await createEvent(request, { ...options, fetcher }).catch((error: unknown) => error);

    expect(error).toBeInstanceOf(EventApiError);
    expect(error).toMatchObject({ status: 201, message: 'イベントを作成できませんでした。時間をおいて再度お試しください。' });
    expect(String(error)).not.toContain('private');
    expect(JSON.stringify(error)).not.toContain('private');
  });
});
