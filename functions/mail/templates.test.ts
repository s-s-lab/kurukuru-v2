// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { responseNotificationMail, verificationMail } from './templates';

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';

describe('Kurukuru mail templates', () => {
  it('builds an escaped 24-hour organizer verification email without Reply-To', () => {
    const mail = verificationMail({
      eventId,
      eventTitle: '<研究会 & 勉強会>',
      organizerEmail: 'owner@example.com',
      token: 'raw/token+value',
      publicBaseUrl: 'https://kurukuru-app.jp/',
    });

    expect(mail).toMatchObject({
      to: 'owner@example.com',
      subject: '【Kurukuru】主催者メールアドレスを確認してください',
      idempotencyKey: expect.stringMatching(/^verification-/),
    });
    expect(mail.html).toContain('&lt;研究会 &amp; 勉強会&gt;');
    expect(mail.html).toContain(
      'https://kurukuru-app.jp/#/email-verifications/raw%2Ftoken%2Bvalue',
    );
    expect(mail.text).toContain('このリンクは24時間有効です。');
    expect(mail.text).toContain('このメールアドレスは送信専用です。');
    expect(mail).not.toHaveProperty('replyTo');
  });

  it('builds a minimal response-created notification without response details', () => {
    const mail = responseNotificationMail({
      eventId,
      eventTitle: '11月の研究会',
      organizerEmail: 'owner@example.com',
      respondentName: '参加者A',
      kind: 'created',
      publicBaseUrl: 'https://kurukuru-app.jp',
      idempotencyKey: 'response-created-1',
    });

    expect(mail.subject).toBe('【Kurukuru】「11月の研究会」に回答が届きました');
    expect(mail.text).toContain('参加者Aさんから回答が届きました。');
    expect(mail.text).toContain(
      `https://kurukuru-app.jp/#/events/${eventId}`,
    );
    expect(mail.text).not.toContain('/admin');
    expect(mail.html).toContain('公開回答ボードを開く');
    expect(mail.text).not.toContain('コメント');
    expect(mail.text).not.toContain('候補日時');
    expect(mail.idempotencyKey).toBe('response-created-1');
  });

  it('uses the updated wording for an edited response', () => {
    const mail = responseNotificationMail({
      eventId,
      eventTitle: '11月の研究会',
      organizerEmail: 'owner@example.com',
      respondentName: '参加者A',
      kind: 'updated',
      publicBaseUrl: 'https://kurukuru-app.jp',
      idempotencyKey: 'response-updated-1',
    });

    expect(mail.subject).toBe('【Kurukuru】「11月の研究会」の回答が更新されました');
    expect(mail.text).toContain('参加者Aさんが回答を更新しました。');
  });
});
