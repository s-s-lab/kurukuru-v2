// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app';
import { IdempotencyConflictError } from './events/postgres-event-repository';
import type { EventService } from './events/service';
import type { ResponseService } from './responses/service';
import { EventNotFoundError, EventClosedError, InvalidAvailabilityError, ResponseNotFoundError } from './responses/repository';
import type { RequestRateLimiter } from './security/rate-limit';

const validEventRequest = {
  title: '研究会の日程調整',
  description: '参加できる時間を選択してください。',
  organizerEmail: 'organizer@example.com',
  adminPassword: 'correct-horse-battery-staple',
  notifyOnResponse: true,
  candidateSlots: [
    { date: '2026-11-04', slotIndexes: [26, 27, 28, 29] },
    { date: '2026-11-05', slotIndexes: [18, 19] },
  ],
};

function createEventServiceFake(): EventService & {
  createCalls: unknown[];
  getCalls: string[];
} {
  const publicEvent = {
    id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
    title: validEventRequest.title,
    description: validEventRequest.description,
    status: 'open' as const,
    finalization: null,
    createdAt: '2026-10-29T07:00:00.000Z',
    updatedAt: '2026-10-29T07:00:00.000Z',
    candidateSlots: [
      {
        id: '150da5e0-f923-492c-be9b-263bf5af58fc',
        date: '2026-11-04',
        slotIndex: 26,
      },
    ],
    responses: [],
  };

  return {
    createCalls: [],
    getCalls: [],
    async createEvent(command) {
      this.createCalls.push(command);
      return { event: publicEvent, emailVerificationRequired: true };
    },
    async getPublicEvent(eventId) {
      this.getCalls.push(eventId);
      return eventId === publicEvent.id ? publicEvent : null;
    },
  };
}

describe('Neon Functions API', () => {
  it('ヘルスチェックに秘密情報を含めず応答する', async () => {
    const app = createApp({ allowedOrigins: ['http://localhost:5173'] });
    const response = await app.request('/api/v1/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: 'ok', service: 'kurukuru-api' });
  });

  it('許可したOriginのプリフライトだけにCORSヘッダーを返す', async () => {
    const app = createApp({ allowedOrigins: ['https://s-s-lab.github.io'] });
    const allowed = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://s-s-lab.github.io' },
    });
    const denied = await app.request('/api/v1/health', {
      method: 'OPTIONS',
      headers: { origin: 'https://example.invalid' },
    });

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://s-s-lab.github.io');
    expect(denied.headers.get('access-control-allow-origin')).toBeNull();
    expect(denied.headers.get('vary')).toBe('Origin');
  });

  it('存在しないAPIは共通形式の404を返す', async () => {
    const app = createApp({ allowedOrigins: [] });
    const response = await app.request('/api/v1/missing');
    const body = (await response.json()) as { code: string; requestId: string };

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ code: 'NOT_FOUND' });
    expect(body.requestId).toEqual(expect.any(String));
  });

  it('イベントと候補枠を作成し、秘密情報を含まない201応答を返す', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000001',
      },
      body: JSON.stringify(validEventRequest),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      event: {
        id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
        title: validEventRequest.title,
      },
      emailVerificationRequired: true,
    });
    expect(JSON.stringify(body)).not.toContain('organizer@example.com');
    expect(JSON.stringify(body)).not.toContain('correct-horse-battery-staple');
    expect(eventService.createCalls).toHaveLength(1);
  });

  it('冪等キーがないイベント作成を400で拒否する', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validEventRequest),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(eventService.createCalls).toHaveLength(0);
  });

  it('候補日・候補枠・入力値の不正を422で返す', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000002',
      },
      body: JSON.stringify({
        ...validEventRequest,
        title: '',
        adminPassword: 'short',
        candidateSlots: [{ date: 'not-a-date', slotIndexes: [11, 48] }],
      }),
    });
    const body = (await response.json()) as { code: string; fieldErrors?: Record<string, string[]> };

    expect(response.status).toBe(422);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.fieldErrors).toMatchObject({
      title: expect.any(Array),
      adminPassword: expect.any(Array),
      candidateSlots: expect.any(Array),
    });
    expect(eventService.createCalls).toHaveLength(0);
  });

  it('公開イベントを取得し、見つからない場合は404を返す', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';
    const found = await app.request(`/api/v1/events/${eventId}`);
    const missing = await app.request('/api/v1/events/bdf75886-1143-4bc6-9a55-a8497c3a60b7');

    expect(found.status).toBe(200);
    await expect(found.json()).resolves.toMatchObject({ id: eventId, responses: [] });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({ code: 'EVENT_NOT_FOUND' });
  });

  it('同じ冪等キーを異なる内容で使った場合は409を返す', async () => {
    const eventService = createEventServiceFake();
    eventService.createEvent = async () => {
      throw new IdempotencyConflictError();
    };
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000003',
      },
      body: JSON.stringify(validEventRequest),
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('不正なイベントIDはDBへ渡さず404を返す', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request('/api/v1/events/not-a-uuid');

    expect(response.status).toBe(404);
    expect(eventService.getCalls).toHaveLength(0);
  });

  it('公開取得でもパスUUIDを小文字へ正規化する', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';
    const response = await app.request(`/api/v1/events/${eventId.toUpperCase()}`);
    expect(response.status).toBe(200);
    expect(eventService.getCalls).toEqual([eventId]);
  });

  it('予期しない内部エラーの詳細を公開しない', async () => {
    const eventService = createEventServiceFake();
    eventService.getPublicEvent = async () => {
      throw new Error('database password must not leak');
    };
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({ allowedOrigins: [], eventService });
    const response = await app.request(
      '/api/v1/events/9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain('INTERNAL_ERROR');
    expect(body).not.toContain('database password');
    expect(errorLog).toHaveBeenCalledTimes(1);
    errorLog.mockRestore();
  });

  it('転送元ヘッダーに依存せず全体回数超過を本文処理前に429で拒否する', async () => {
    const eventService = createEventServiceFake();
    const rateLimiter: RequestRateLimiter = {
      check: vi.fn(async () => ({ allowed: false, retryAfterSeconds: 42 })),
    };
    const app = createApp({ allowedOrigins: [], eventService, rateLimiter });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000004',
        'x-forwarded-for': '203.0.113.10',
      },
      body: JSON.stringify(validEventRequest),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('42');
    await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect(rateLimiter.check).toHaveBeenCalledWith({
      scope: 'create-event-global',
      subject: 'all',
      limit: 60,
      windowSeconds: 60,
    });
    expect(eventService.createCalls).toHaveLength(0);
  });

  it('検証済み入力の主催者メール単位で回数を制限する', async () => {
    const eventService = createEventServiceFake();
    const rateLimiter: RequestRateLimiter = {
      check: vi
        .fn()
        .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 60 })
        .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 300 }),
    };
    const app = createApp({ allowedOrigins: [], eventService, rateLimiter });
    const response = await app.request('/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000006',
      },
      body: JSON.stringify({ ...validEventRequest, organizerEmail: 'ORGANIZER@example.com' }),
    });

    expect(response.status).toBe(429);
    expect(rateLimiter.check).toHaveBeenNthCalledWith(2, {
      scope: 'create-event-email',
      subject: 'organizer@example.com',
      limit: 10,
      windowSeconds: 600,
    });
    expect(eventService.createCalls).toHaveLength(0);
  });

  it('64KiBを超えるイベント作成本文を413で拒否する', async () => {
    const eventService = createEventServiceFake();
    const app = createApp({ allowedOrigins: [], eventService });
    const encoder = new TextEncoder();
    let pullCount = 0;
    let cancelled = false;
    const oversizedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        if (pullCount <= 2) {
          controller.enqueue(encoder.encode('a'.repeat(40_000)));
          return;
        }
        controller.error(new Error('本文上限を超えた後まで読み込んではいけません。'));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new Request('http://localhost/api/v1/events', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': 'create-event-00000005',
      },
      body: oversizedBody,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    const response = await app.request(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(pullCount).toBe(2);
    expect(cancelled).toBe(true);
    expect(eventService.createCalls).toHaveLength(0);
  });
});

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';
const responseId = 'a9210ea7-8827-448a-952a-8510a6fdcb44';
const responseRequest = {
  displayName: '  参加者  ',
  comment: '  よろしくお願いします  ',
  availability: [{ candidateSlotId: '150da5e0-f923-492c-be9b-263bf5af58fc', mark: 'ok' as const }],
};
const publicResponse = {
  id: responseId,
  displayName: '参加者',
  comment: 'よろしくお願いします',
  createdAt: '2026-10-30T00:00:00.000Z',
  updatedAt: '2026-10-30T00:00:00.000Z',
  availability: responseRequest.availability,
};

function responseServiceFake(): ResponseService {
  return {
    createResponse: vi.fn(async () => ({ response: publicResponse, editToken: 'edit-token' })),
    updateResponse: vi.fn(async () => ({ response: publicResponse })),
  };
}

const responseRoutes = [
  { method: 'POST', path: `/api/v1/events/${eventId}/responses`, global: 'create-response-global', resource: 'create-response-event', subject: eventId, limit: 120 },
  { method: 'PATCH', path: `/api/v1/responses/${responseId}`, global: 'update-response-global', resource: 'update-response-id', subject: responseId, limit: 60 },
];

function responseHeaders() {
  return { 'content-type': 'application/json', 'idempotency-key': 'response-create-0001', authorization: 'Bearer edit-token', 'x-request-id': 'response-request-id' };
}

async function expectResponseError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get('x-request-id')).toBe('response-request-id');
  await expect(response.json()).resolves.toMatchObject({ code, message: expect.any(String), requestId: 'response-request-id' });
}

describe('回答API', () => {
  it('POSTは正規化したIDと入力を渡し、再送時も201と編集トークンを返す', async () => {
    const responseService = responseServiceFake();
    const app = createApp({ allowedOrigins: [], responseService });
    for (let i = 0; i < 2; i += 1) {
      const response = await app.request(`/api/v1/events/${eventId.toUpperCase()}/responses`, { method: 'POST', headers: responseHeaders(), body: JSON.stringify(responseRequest) });
      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ response: publicResponse, editToken: 'edit-token' });
    }
    expect(responseService.createResponse).toHaveBeenCalledTimes(2);
    expect(responseService.createResponse).toHaveBeenCalledWith({ eventId, idempotencyKey: 'response-create-0001', request: { ...responseRequest, displayName: '参加者', comment: 'よろしくお願いします' } });
  });

  it('PATCHは正規化したIDとBearerを渡し、200本文にトークンを含めない', async () => {
    const responseService = responseServiceFake();
    const app = createApp({ allowedOrigins: [], responseService });
    const response = await app.request(`/api/v1/responses/${responseId.toUpperCase()}`, { method: 'PATCH', headers: responseHeaders(), body: JSON.stringify(responseRequest) });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ response: publicResponse });
    expect(responseService.updateResponse).toHaveBeenCalledWith({ responseId, editToken: 'edit-token', request: { ...responseRequest, displayName: '参加者', comment: 'よろしくお願いします' } });
  });

  it.each([undefined, '', 'short', 'x'.repeat(129)])('不正な冪等キー %s は400', async (key) => {
    const responseService = responseServiceFake();
    const headers: Record<string, string> = responseHeaders();
    if (key === undefined) delete headers['idempotency-key'];
    else headers['idempotency-key'] = key;
    const app = createApp({ allowedOrigins: [], responseService });
    await expectResponseError(await app.request(responseRoutes[0].path, { method: 'POST', headers, body: JSON.stringify(responseRequest) }), 400, 'IDEMPOTENCY_KEY_REQUIRED');
    expect(responseService.createResponse).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'Basic edit-token', 'Bearer', 'Bearer token extra'])('Bearer欠落・形式不正 %s を同じ404にする', async (authorization) => {
    const responseService = responseServiceFake();
    const headers: Record<string, string> = responseHeaders();
    if (authorization === undefined) delete headers.authorization;
    else headers.authorization = authorization;
    const app = createApp({ allowedOrigins: [], responseService });
    await expectResponseError(await app.request(responseRoutes[1].path, { method: 'PATCH', headers, body: JSON.stringify(responseRequest) }), 404, 'RESPONSE_NOT_FOUND');
    expect(responseService.updateResponse).not.toHaveBeenCalled();
  });

  for (const route of responseRoutes) {
    describe(route.method, () => {
      it('不正なパスUUIDをサービスへ渡さず404にする', async () => {
        const responseService = responseServiceFake();
        const app = createApp({ allowedOrigins: [], responseService });
        const path = route.path.replace(route.subject, 'not-a-uuid');
        await expectResponseError(await app.request(path, { method: route.method, headers: responseHeaders(), body: JSON.stringify(responseRequest) }), 404, route.method === 'POST' ? 'EVENT_NOT_FOUND' : 'RESPONSE_NOT_FOUND');
        expect(responseService.createResponse).not.toHaveBeenCalled();
        expect(responseService.updateResponse).not.toHaveBeenCalled();
      });

      it('不正なJSONは400にする', async () => {
        const app = createApp({ allowedOrigins: [], responseService: responseServiceFake() });
        await expectResponseError(await app.request(route.path, { method: route.method, headers: responseHeaders(), body: '{' }), 400, 'INVALID_JSON');
      });

      it('入力不正をfieldErrors付き422にする', async () => {
        const responseService = responseServiceFake();
        const app = createApp({ allowedOrigins: [], responseService });
        const response = await app.request(route.path, { method: route.method, headers: responseHeaders(), body: JSON.stringify({ displayName: ' ', comment: 'x'.repeat(1001), availability: [] }) });
        expect(response.status).toBe(422);
        await expect(response.json()).resolves.toMatchObject({ code: 'VALIDATION_ERROR', requestId: 'response-request-id', fieldErrors: { displayName: expect.any(Array), comment: expect.any(Array), availability: expect.any(Array) } });
        expect(responseService.createResponse).not.toHaveBeenCalled();
        expect(responseService.updateResponse).not.toHaveBeenCalled();
      });

      it('Content-Lengthが128KiB超なら413にする', async () => {
        const app = createApp({ allowedOrigins: [], responseService: responseServiceFake() });
        await expectResponseError(await app.request(route.path, { method: route.method, headers: { ...responseHeaders(), 'content-length': String(128 * 1024 + 1) }, body: '{}' }), 413, 'PAYLOAD_TOO_LARGE');
      });

      it('Content-Lengthなしでもストリームを128KiBで中断する', async () => {
        const responseService = responseServiceFake();
        const app = createApp({ allowedOrigins: [], responseService });
        let pulls = 0;
        let cancelled = false;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pulls += 1;
            if (pulls <= 2) controller.enqueue(new Uint8Array(70_000));
            else controller.error(new Error('body must not be read after the limit'));
          },
          cancel() { cancelled = true; },
        }, { highWaterMark: 0 });
        const request = new Request(`http://localhost${route.path}`, { method: route.method, headers: responseHeaders(), body: stream, duplex: 'half' } as RequestInit & { duplex: 'half' });
        await expectResponseError(await app.request(request), 413, 'PAYLOAD_TOO_LARGE');
        expect(pulls).toBe(2);
        expect(cancelled).toBe(true);
        expect(responseService.createResponse).not.toHaveBeenCalled();
        expect(responseService.updateResponse).not.toHaveBeenCalled();
      });

      it('上限超過後のストリームcancelエラーでも413を維持する', async () => {
        const app = createApp({ allowedOrigins: [], responseService: responseServiceFake() });
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) { controller.enqueue(new Uint8Array(128 * 1024 + 1)); },
          cancel() { throw new Error('cancel failed'); },
        }, { highWaterMark: 0 });
        const request = new Request(`http://localhost${route.path}`, {
          method: route.method,
          headers: responseHeaders(),
          body: stream,
          duplex: 'half',
        } as RequestInit & { duplex: 'half' });
        await expectResponseError(await app.request(request), 413, 'PAYLOAD_TOO_LARGE');
      });

      it('128KiBちょうどのJSONを受理する', async () => {
        const app = createApp({ allowedOrigins: [], responseService: responseServiceFake() });
        const json = JSON.stringify(responseRequest);
        const body = json + ' '.repeat(128 * 1024 - new TextEncoder().encode(json).length);
        const response = await app.request(route.path, { method: route.method, headers: responseHeaders(), body });
        expect(response.status).toBe(route.method === 'POST' ? 201 : 200);
      });

      it.each([0, 1])('全体・リソース制限 index %s は429とRetry-Afterを返す', async (deniedIndex) => {
        const responseService = responseServiceFake();
        const rateLimiter: RequestRateLimiter = { check: vi.fn(async () => ({ allowed: true, retryAfterSeconds: 1 })) };
        vi.mocked(rateLimiter.check).mockResolvedValueOnce({ allowed: deniedIndex !== 0, retryAfterSeconds: 42 }).mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 84 });
        const app = createApp({ allowedOrigins: [], responseService, rateLimiter });
        const response = await app.request(route.path.replace(route.subject, route.subject.toUpperCase()), { method: route.method, headers: { ...responseHeaders(), 'x-forwarded-for': '203.0.113.10' }, body: deniedIndex === 0 ? '{' : JSON.stringify(responseRequest) });
        await expectResponseError(response, 429, 'RATE_LIMIT_EXCEEDED');
        expect(response.headers.get('retry-after')).toBe(deniedIndex === 0 ? '42' : '84');
        expect(rateLimiter.check).toHaveBeenNthCalledWith(1, { scope: route.global, subject: 'all', limit: 300, windowSeconds: 60 });
        if (deniedIndex === 1) expect(rateLimiter.check).toHaveBeenNthCalledWith(2, { scope: route.resource, subject: route.subject, limit: route.limit, windowSeconds: 600 });
        expect(responseService.createResponse).not.toHaveBeenCalled();
        expect(responseService.updateResponse).not.toHaveBeenCalled();
      });

      it.each([
        [new EventNotFoundError(), 404, 'EVENT_NOT_FOUND'],
        [new EventClosedError(), 409, 'EVENT_CLOSED'],
        [new InvalidAvailabilityError(), 422, 'INVALID_AVAILABILITY'],
        [new IdempotencyConflictError(), 409, 'IDEMPOTENCY_KEY_REUSED'],
        [new ResponseNotFoundError(), 404, 'RESPONSE_NOT_FOUND'],
      ] as const)('永続化エラー %s を明示的に写像する', async (error, status, code) => {
        const responseService = responseServiceFake();
        vi.mocked(responseService.createResponse).mockRejectedValue(error);
        vi.mocked(responseService.updateResponse).mockRejectedValue(error);
        const app = createApp({ allowedOrigins: [], responseService });
        const response = await app.request(route.path, { method: route.method, headers: responseHeaders(), body: JSON.stringify(responseRequest) });
        if (code === 'INVALID_AVAILABILITY') {
          expect(response.status).toBe(422);
          await expect(response.json()).resolves.toMatchObject({ code, requestId: 'response-request-id', fieldErrors: { availability: expect.any(Array) } });
        } else await expectResponseError(response, status, code);
      });

      it('未構成サービスは共通形式の503を返す', async () => {
        const app = createApp({ allowedOrigins: [] });
        await expectResponseError(await app.request(route.path, { method: route.method, headers: responseHeaders(), body: JSON.stringify(responseRequest) }), 503, 'SERVICE_UNAVAILABLE');
      });
    });
  }
});
