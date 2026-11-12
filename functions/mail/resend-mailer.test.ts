// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { MailDeliveryError, ResendMailer } from './resend-mailer';

const message = {
  to: 'owner@example.com',
  subject: '件名',
  html: '<p>本文</p>',
  text: '本文',
  idempotencyKey: 'notification-123',
};

describe('ResendMailer', () => {
  it('sends the approved no-reply message with provider idempotency', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ id: 'resend-message-1' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    const mailer = new ResendMailer({
      apiKey: 're_secret',
      from: 'Kurukuru <no-reply@notify.kurukuru-app.jp>',
      fetcher,
    });

    await expect(mailer.send(message)).resolves.toEqual({
      providerMessageId: 'resend-message-1',
    });
    expect(fetcher).toHaveBeenCalledWith('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer re_secret',
        'content-type': 'application/json',
        'idempotency-key': 'notification-123',
      },
      body: JSON.stringify({
        from: 'Kurukuru <no-reply@notify.kurukuru-app.jp>',
        to: ['owner@example.com'],
        subject: '件名',
        html: '<p>本文</p>',
        text: '本文',
      }),
      signal: expect.any(AbortSignal),
    });
  });

  it('turns non-success and malformed success responses into a safe delivery error', async () => {
    const providerFailure = new ResendMailer({
      apiKey: 're_secret', from: 'from@example.com',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('provider secret response', { status: 422 }),
      ),
    });
    const malformedSuccess = new ResendMailer({
      apiKey: 're_secret', from: 'from@example.com',
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(JSON.stringify({ unexpected: true }), { status: 200 }),
      ),
    });

    await expect(providerFailure.send(message)).rejects.toEqual(
      expect.objectContaining<Partial<MailDeliveryError>>({
        name: 'MailDeliveryError', category: 'provider-rejected',
      }),
    );
    await expect(malformedSuccess.send(message)).rejects.toEqual(
      expect.objectContaining<Partial<MailDeliveryError>>({
        name: 'MailDeliveryError', category: 'invalid-provider-response',
      }),
    );
    await expect(providerFailure.send(message)).rejects.not.toThrow('provider secret response');
  });

  it('turns network failures into a safe delivery error', async () => {
    const mailer = new ResendMailer({
      apiKey: 're_secret', from: 'from@example.com',
      fetcher: vi.fn<typeof fetch>().mockRejectedValue(new Error('socket leaked secret')),
    });

    await expect(mailer.send(message)).rejects.toEqual(
      expect.objectContaining<Partial<MailDeliveryError>>({
        name: 'MailDeliveryError', category: 'network-failure',
      }),
    );
  });

  it('providerが応答しない場合はタイムアウトして再試行可能な失敗にする', async () => {
    const fetcher = vi.fn<typeof fetch>((_url, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }));
    const mailer = new ResendMailer({
      apiKey: 're_secret', from: 'from@example.com', fetcher, timeoutMs: 5,
    });

    const outcome = await Promise.race([
      mailer.send(message).then(() => 'resolved', (error: unknown) => error),
      new Promise((resolve) => setTimeout(() => resolve('test-timed-out'), 100)),
    ]);

    expect(outcome).toEqual(expect.objectContaining<Partial<MailDeliveryError>>({
      name: 'MailDeliveryError', category: 'network-failure',
    }));
  });
});
