// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { PublicResponse } from '../events/service';
import { deriveResponseEditToken } from '../security/secrets';
import { createResponseService } from './response-service';
import type {
  CreateResponsePersistenceInput,
  ResponseRepository,
  UpdateResponsePersistenceInput,
} from './service';
import { responseRequestSchema } from './validation';

const firstSlot = '11111111-1111-4111-8111-111111111111';
const secondSlot = '22222222-2222-4222-8222-222222222222';
const responseId = '33333333-3333-4333-8333-333333333333';
const eventId = '44444444-4444-4444-8444-444444444444';
const tokenSecret = 'a-secret-held-only-by-the-service';
const request = {
  displayName: '参加者',
  comment: 'よろしく',
  availability: [
    { candidateSlotId: firstSlot, mark: 'best' as const },
    { candidateSlotId: secondSlot, mark: 'ng' as const },
  ],
};
const publicResponse: PublicResponse = {
  id: responseId,
  ...request,
  createdAt: '2026-10-30T07:00:00.000Z',
  updatedAt: '2026-10-30T07:00:00.000Z',
};

function repositoryFake() {
  const createInputs: CreateResponsePersistenceInput[] = [];
  const updateInputs: UpdateResponsePersistenceInput[] = [];
  const repository: ResponseRepository = {
    async createResponse(input) {
      createInputs.push(input);
      return { response: publicResponse };
    },
    async updateResponse(input) {
      updateInputs.push(input);
      return { response: publicResponse };
    },
  };
  return { repository, createInputs, updateInputs };
}

// Rejecting any of these malformed bodies or losing canonical order must break these tests.
describe('回答リクエストの検証', () => {
  it('名前・コメントをtrimし、候補枠IDの順に正規化する', () => {
    expect(responseRequestSchema.parse({
      displayName: ' 参加者 ', comment: ' よろしく ',
      availability: [...request.availability].reverse(),
    })).toEqual(request);
  });

  it('大小文字だけ異なる同一UUIDの重複を拒否する', () => {
    expect(responseRequestSchema.safeParse({
      ...request,
      availability: [
        { candidateSlotId: 'abcdefab-cdef-4abc-8def-abcdefabcdef', mark: 'best' },
        { candidateSlotId: 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF', mark: 'ng' },
      ],
    }).success).toBe(false);
  });

  it('大文字UUIDを小文字へ正規化してから並べ替える', () => {
    const uppercase = responseRequestSchema.parse({
      ...request,
      availability: [
        { candidateSlotId: 'BCDEFABC-DEFA-4BCD-8EFA-BCDEFABCDEF0', mark: 'ok' },
        { candidateSlotId: 'abcdefab-cdef-4abc-8def-abcdefabcdef', mark: 'best' },
      ],
    });
    expect(uppercase.availability).toEqual([
      { candidateSlotId: 'abcdefab-cdef-4abc-8def-abcdefabcdef', mark: 'best' },
      { candidateSlotId: 'bcdefabc-defa-4bcd-8efa-bcdefabcdef0', mark: 'ok' },
    ]);
    expect(uppercase).toEqual(responseRequestSchema.parse({
      ...request,
      availability: [...uppercase.availability].reverse(),
    }));
  });

  it.each([
    { ...request, displayName: '   ' },
    { ...request, displayName: 'a'.repeat(81) },
    { ...request, comment: 'a'.repeat(1001) },
    { ...request, availability: [] },
    { ...request, availability: [request.availability[0], request.availability[0]] },
    { ...request, availability: [{ candidateSlotId: firstSlot, mark: 'invalid' }] },
    { ...request, availability: [{ candidateSlotId: 'invalid', mark: 'ok' }] },
    { ...request, availability: Array.from({ length: 721 }, (_, i) => ({
      candidateSlotId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      mark: 'maybe',
    })) },
  ])('不正な入力を拒否する %#', (body) => {
    expect(responseRequestSchema.safeParse(body).success).toBe(false);
  });

  it('名前80文字・コメント1000文字・720枠とすべてのmarkを受け付ける', () => {
    const availability = Array.from({ length: 720 }, (_, i) => ({
      candidateSlotId: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      mark: ['best', 'ok', 'maybe', 'ng'][i % 4],
    }));
    expect(responseRequestSchema.safeParse({
      displayName: 'a'.repeat(80), comment: 'a'.repeat(1000), availability,
    }).success).toBe(true);
    expect(responseRequestSchema.safeParse({ ...request, comment: '' }).success).toBe(true);
  });
});

describe('回答サービス', () => {
  it('新規IDに対応するハッシュだけを保存境界へ渡し、返却IDの編集トークンを返す', async () => {
    const { repository, createInputs } = repositoryFake();
    const service = createResponseService(repository, tokenSecret, {
      generateResponseId: () => responseId,
    });
    const result = await service.createResponse({ eventId, idempotencyKey: 'create-key', request });
    const token = deriveResponseEditToken(tokenSecret, responseId);
    expect(result).toEqual({ response: publicResponse, editToken: token });
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toEqual({
      eventId, idempotencyKey: 'create-key', responseId, request,
      requestHash: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
      editTokenHash: createHash('sha256').update(token).digest('hex'),
    });
    expect(JSON.stringify(createInputs)).not.toContain(token);
    expect(JSON.stringify(createInputs)).not.toContain(tokenSecret);
  });

  it('正規化後の同じ本文は同じハッシュを持ち、冪等再送では保存済みIDのトークンを返す', async () => {
    const { repository, createInputs } = repositoryFake();
    let generated = 0;
    const service = createResponseService(repository, tokenSecret, {
      generateResponseId: () => `55555555-5555-4555-8555-${String(++generated).padStart(12, '0')}`,
    });
    const first = await service.createResponse({ eventId, idempotencyKey: 'same-key', request });
    const replay = await service.createResponse({ eventId, idempotencyKey: 'same-key', request: {
      displayName: ' 参加者 ', comment: ' よろしく ',
      availability: [...request.availability].reverse(),
    } });
    expect(replay).toEqual(first);
    expect(first.editToken).toBe(deriveResponseEditToken(tokenSecret, responseId));
    expect(createInputs[0].responseId).not.toBe(createInputs[1].responseId);
    expect(createInputs[1].request).toEqual(request);
    expect(createInputs[1].requestHash).toBe(createInputs[0].requestHash);
    await service.createResponse({ eventId, idempotencyKey: 'other-key', request: { ...request, comment: '変更' } });
    expect(createInputs[2].requestHash).not.toBe(createInputs[0].requestHash);
  });

  it('更新は受け取ったトークンのハッシュを渡し、トークンを返さない', async () => {
    const { repository, updateInputs } = repositoryFake();
    const service = createResponseService(repository, tokenSecret);
    const result = await service.updateResponse({ responseId, editToken: 'provided-edit-token', request });
    expect(result).toEqual({ response: publicResponse });
    expect(updateInputs).toEqual([{
      responseId, request,
      editTokenHash: createHash('sha256').update('provided-edit-token').digest('hex'),
    }]);
    expect(JSON.stringify(updateInputs)).not.toContain('provided-edit-token');
    expect(JSON.stringify(updateInputs)).not.toContain(tokenSecret);
  });
});
