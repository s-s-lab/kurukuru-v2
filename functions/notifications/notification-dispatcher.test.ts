// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { MailSender } from '../mail/service';
import { MailDeliveryError } from '../mail/resend-mailer';
import { createNotificationDispatcher } from './notification-dispatcher';
import type { ClaimedNotification, NotificationRepository } from './repository';

function item(overrides: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return {
    id: 'notification-1',
    eventId: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
    eventTitle: '研究会',
    organizerEmail: 'organizer@example.com',
    responseId: 'a9210ea7-8827-448a-952a-8510a6fdcb44',
    respondentName: '参加者',
    kind: 'created',
    attempts: 1,
    idempotencyKey: 'response-created:a9210ea7-8827-448a-952a-8510a6fdcb44',
    ...overrides,
  };
}

describe('通知ディスパッチャー', () => {
  it('claimした通知を冪等キー付きで送り送信済みにする', async () => {
    const repository: NotificationRepository = {
      claim: vi.fn(async () => [item()]),
      markSent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const mailSender: MailSender = {
      send: vi.fn(async () => ({ providerMessageId: 'provider-1' })),
    };
    const dispatcher = createNotificationDispatcher({
      repository,
      mailSender,
      publicBaseUrl: 'https://kurukuru-app.jp',
    });

    await expect(dispatcher.drain(10)).resolves.toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(mailSender.send).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: 'response-created:a9210ea7-8827-448a-952a-8510a6fdcb44',
    }));
    expect(repository.markSent).toHaveBeenCalledWith('notification-1', 'provider-1');
  });

  it('配信失敗を安全な分類だけで記録し残りを継続する', async () => {
    const repository: NotificationRepository = {
      claim: vi.fn(async () => [item(), item({ id: 'notification-2' })]),
      markSent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const mailSender: MailSender = {
      send: vi.fn()
        .mockRejectedValueOnce(new MailDeliveryError('provider-rejected'))
        .mockResolvedValueOnce({ providerMessageId: 'provider-2' }),
    };
    const dispatcher = createNotificationDispatcher({ repository, mailSender, publicBaseUrl: 'https://kurukuru-app.jp' });

    await expect(dispatcher.drain(2)).resolves.toEqual({ processed: 2, sent: 1, failed: 1 });
    expect(repository.markFailed).toHaveBeenCalledWith('notification-1', 'provider-rejected');
    expect(repository.markSent).toHaveBeenCalledWith('notification-2', 'provider-2');
  });

  it('不明な例外の本文を保存しない', async () => {
    const repository: NotificationRepository = {
      claim: vi.fn(async () => [item()]),
      markSent: vi.fn(async () => undefined),
      markFailed: vi.fn(async () => undefined),
    };
    const mailSender: MailSender = { send: vi.fn(async () => { throw new Error('secret provider payload'); }) };
    const dispatcher = createNotificationDispatcher({ repository, mailSender, publicBaseUrl: 'https://kurukuru-app.jp' });

    await dispatcher.drain(1);
    expect(repository.markFailed).toHaveBeenCalledWith('notification-1', 'unexpected-mail-error');
    expect(JSON.stringify(vi.mocked(repository.markFailed).mock.calls)).not.toContain('secret provider payload');
  });
});
