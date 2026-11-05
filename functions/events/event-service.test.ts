// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createEventService } from './event-service';
import type {
  CreateEventPersistenceInput,
  EventRepository,
} from './repository';
import type { PublicEvent } from './service';

const publicEvent: PublicEvent = {
  id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
  title: '研究会の日程調整',
  description: '',
  status: 'open',
  finalization: null,
  createdAt: '2026-10-29T07:00:00.000Z',
  updatedAt: '2026-10-29T07:00:00.000Z',
  candidateSlots: [],
  responses: [],
};

function createRepositoryFake() {
  const createInputs: CreateEventPersistenceInput[] = [];
  const getIds: string[] = [];
  const repository: EventRepository = {
    async createEvent(input) {
      createInputs.push(input);
      return { event: publicEvent, emailVerificationRequired: true, created: true };
    },
    async getPublicEvent(eventId) {
      getIds.push(eventId);
      return eventId === publicEvent.id ? publicEvent : null;
    },
  };
  return { repository, createInputs, getIds };
}

describe('イベントサービス', () => {
  it('秘密情報をハッシュ化し、候補枠をDB登録形式へ変換する', async () => {
    const { repository, createInputs } = createRepositoryFake();
    const service = createEventService(repository, {
      hashPassword: async (password) => `password-hash:${password.length}`,
      generateToken: () => 'verification-token-raw',
      hashToken: (token) => `token-hash:${token.length}`,
      now: () => new Date('2026-10-29T07:00:00.000Z'),
    });

    const result = await service.createEvent({
      idempotencyKey: 'create-event-00000001',
      request: {
        title: '研究会の日程調整',
        description: '',
        organizerEmail: 'organizer@example.com',
        adminPassword: 'correct-horse-battery-staple',
        notifyOnResponse: true,
        candidateSlots: [
          { date: '2026-11-04', slotIndexes: [26, 27] },
          { date: '2026-11-05', slotIndexes: [18] },
        ],
      },
    });

    expect(result).toEqual({ event: publicEvent, emailVerificationRequired: true });
    expect(createInputs).toHaveLength(1);
    expect(createInputs[0]).toMatchObject({
      idempotencyKey: 'create-event-00000001',
      event: {
        title: '研究会の日程調整',
        organizerEmail: 'organizer@example.com',
        adminSecretHash: 'password-hash:28',
        notifyOnResponse: true,
      },
      candidateSlots: [
        { date: '2026-11-04', slotIndex: 26 },
        { date: '2026-11-04', slotIndex: 27 },
        { date: '2026-11-05', slotIndex: 18 },
      ],
      emailVerification: {
        tokenHash: 'token-hash:22',
        expiresAt: new Date('2026-10-30T07:00:00.000Z'),
      },
    });
    expect(createInputs[0].requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(createInputs[0])).not.toContain('correct-horse-battery-staple');
    expect(JSON.stringify(createInputs[0])).not.toContain('verification-token-raw');
  });

  it('公開イベント取得をリポジトリへ委譲する', async () => {
    const { repository, getIds } = createRepositoryFake();
    const service = createEventService(repository);

    await expect(service.getPublicEvent(publicEvent.id)).resolves.toEqual(publicEvent);
    expect(getIds).toEqual([publicEvent.id]);
  });

  it('通知ONの新規作成時だけ主催者確認メールを自動送信する', async () => {
    const { repository } = createRepositoryFake();
    const send = vi.fn().mockResolvedValue({ providerMessageId: 'mail-1' });
    const service = createEventService(repository, {
      generateToken: () => 'verification-token-raw',
      mailSender: { send },
      publicBaseUrl: 'https://kurukuru-app.jp',
    });

    await service.createEvent({ idempotencyKey: 'create-event-mail-1', request: {
      title: '研究会', description: '', organizerEmail: 'organizer@example.com',
      adminPassword: 'password', notifyOnResponse: true,
      candidateSlots: [{ date: '2026-11-04', slotIndexes: [18] }],
    } });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'organizer@example.com',
      text: expect.stringContaining('verification-token-raw'),
    }));
  });

  it('通知OFFでは確認メールを送らず、送信失敗でもイベント作成を成功させる', async () => {
    const { repository } = createRepositoryFake();
    const send = vi.fn().mockRejectedValue(new Error('mail unavailable'));
    const service = createEventService(repository, {
      mailSender: { send }, publicBaseUrl: 'https://kurukuru-app.jp',
    });
    const baseRequest = {
      title: '研究会', description: '', organizerEmail: 'organizer@example.com',
      adminPassword: 'password', candidateSlots: [{ date: '2026-11-04', slotIndexes: [18] }],
    };

    await expect(service.createEvent({ idempotencyKey: 'create-event-mail-off',
      request: { ...baseRequest, notifyOnResponse: false } })).resolves.toMatchObject({ event: publicEvent });
    expect(send).not.toHaveBeenCalled();
    await expect(service.createEvent({ idempotencyKey: 'create-event-mail-failure',
      request: { ...baseRequest, notifyOnResponse: true } })).resolves.toMatchObject({ event: publicEvent });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
