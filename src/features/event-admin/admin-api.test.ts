import { describe, expect, it, vi } from 'vitest';

import {
  AdminApiError,
  closeAdminEvent,
  createAdminSession,
  getAdminEvent,
  reopenAdminEvent,
  updateAdminEvent,
} from './admin-api';

const eventId = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const responseId = '33333333-3333-4333-8333-333333333333';
const token = 'opaque-admin-session-token';

const adminEvent = {
  id: eventId,
  title: '11月のプロジェクト定例',
  description: '都合のよい日時を教えてください。',
  organizerEmail: 'organizer@example.com',
  organizerEmailVerified: true,
  notifyOnResponse: true,
  status: 'open' as const,
  finalization: null,
  version: 3,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-02T00:00:00.000Z',
  candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }],
  responses: [{
    id: responseId,
    displayName: '山田 太郎',
    comment: '参加できます。',
    createdAt: '2026-11-01T01:00:00.000Z',
    updatedAt: '2026-11-01T02:00:00.000Z',
    availability: [{ candidateSlotId: slotId, mark: 'best' as const }],
  }],
};

describe('organizer admin API client', () => {
  it('creates a session with the password and validates the complete result', async () => {
    const result = {
      sessionToken: token,
      expiresAt: '2026-11-02T12:00:00.000Z',
      event: adminEvent,
    };
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(result, { status: 201 }));

    await expect(createAdminSession(eventId, 'correct horse battery staple', {
      apiBaseUrl: '/api/v1///', fetcher,
    })).resolves.toEqual(result);
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/events/${eventId}/admin/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    });
  });

  it('gets, updates, closes, and reopens with the admin bearer token', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push([input, init]);
      return Response.json(adminEvent);
    };
    const options = { apiBaseUrl: 'https://api.example.test/api/v1/', sessionToken: token, fetcher };

    await getAdminEvent(eventId, options);
    await updateAdminEvent(eventId, {
      title: '更新後', description: '新しい説明', notifyOnResponse: false,
    }, options);
    await closeAdminEvent(eventId, options);
    await reopenAdminEvent(eventId, options);

    expect(calls).toEqual([
      [`https://api.example.test/api/v1/events/${eventId}/admin`, {
        headers: { accept: 'application/json', authorization: `Bearer ${token}` },
      }],
      [`https://api.example.test/api/v1/events/${eventId}`, {
        method: 'PATCH',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ title: '更新後', description: '新しい説明', notifyOnResponse: false }),
      }],
      [`https://api.example.test/api/v1/events/${eventId}/close`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      }],
      [`https://api.example.test/api/v1/events/${eventId}/reopen`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` },
      }],
    ]);
  });

  it('exposes only documented API error fields', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      code: 'VALIDATION_ERROR',
      message: '入力内容を確認してください。',
      fieldErrors: { title: ['イベント名を入力してください。'] },
      requestId: 'request-422',
      debug: 'private upstream detail',
    }, { status: 422 });

    const error = await updateAdminEvent(eventId, {
      title: '', description: '', notifyOnResponse: true,
    }, { apiBaseUrl: '/api/v1', sessionToken: token, fetcher }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({
      status: 422,
      code: 'VALIDATION_ERROR',
      message: '入力内容を確認してください。',
      fieldErrors: { title: ['イベント名を入力してください。'] },
      requestId: 'request-422',
    });
    expect(JSON.stringify(error)).not.toContain('private upstream detail');
  });

  it.each([
    ['network failure', async () => { throw new Error('private network detail'); }],
    ['non-JSON failure', async () => new Response('private proxy detail', { status: 502 })],
    ['malformed success', async () => Response.json({ event: 'private success detail' })],
  ])('uses a safe message for %s', async (_label, fetcher) => {
    const error = await getAdminEvent(eventId, {
      apiBaseUrl: '/api/v1', sessionToken: token, fetcher: fetcher as typeof fetch,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({
      message: '管理情報を読み込めませんでした。時間をおいて再度お試しください。',
    });
    expect(String(error)).not.toContain('private');
    expect(JSON.stringify(error)).not.toContain('private');
  });

  it.each([
    ['invalid candidate date', { ...adminEvent, candidateSlots: [{ ...adminEvent.candidateSlots[0], date: '2026-02-31' }] }],
    ['out-of-range slot index', { ...adminEvent, candidateSlots: [{ ...adminEvent.candidateSlots[0], slotIndex: 99 }] }],
    ['invalid update timestamp', { ...adminEvent, updatedAt: 'not-a-timestamp' }],
    ['backwards finalization', { ...adminEvent, finalization: { date: '2026-11-10', startSlot: 20, endSlot: 19 } }],
    ['out-of-range finalization end', { ...adminEvent, finalization: { date: '2026-11-10', startSlot: 47, endSlot: 49 } }],
  ])('rejects semantically malformed successful data: %s', async (_label, payload) => {
    const fetcher: typeof fetch = async () => Response.json(payload);
    const error = await getAdminEvent(eventId, {
      apiBaseUrl: '/api/v1', sessionToken: token, fetcher,
    }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AdminApiError);
    expect(error).toMatchObject({
      status: 200,
      message: '管理情報を読み込めませんでした。時間をおいて再度お試しください。',
    });
  });

  it('rejects a session with an invalid expiry timestamp', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      sessionToken: token, expiresAt: 'not-a-timestamp', event: adminEvent,
    }, { status: 201 });
    await expect(createAdminSession(eventId, 'password', { apiBaseUrl: '/api/v1', fetcher }))
      .rejects.toEqual(expect.objectContaining({
        status: 201,
        message: '管理画面を開けませんでした。入力内容を確認して再度お試しください。',
      }));
  });
});
