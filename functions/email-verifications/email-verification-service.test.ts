// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import type { MailSender } from '../mail/service';
import { createEmailVerificationService } from './email-verification-service';
import {
  EmailVerificationNotFoundError,
  type EmailVerificationRepository,
} from './repository';

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';
const now = new Date('2026-11-03T12:00:00.000Z');

function setup(prepareResult: Awaited<ReturnType<EmailVerificationRepository['prepareSend']>> = {
  status: 'ready', eventTitle: '研究会', organizerEmail: 'owner@example.com',
}) {
  const repository: EmailVerificationRepository = {
    prepareSend: vi.fn(async () => prepareResult),
    verify: vi.fn(async () => ({ eventId })),
  };
  const mailSender: MailSender = {
    send: vi.fn(async () => ({ providerMessageId: 'provider-1' })),
  };
  const service = createEmailVerificationService({ repository, mailSender, publicBaseUrl: 'https://kurukuru-app.jp' }, {
    now: () => now,
    generateToken: () => 'raw-verification-token',
    hashToken: (value) => value === 'admin-session'
      ? 'hashed-admin-session'
      : 'hashed-verification-token',
  });
  return { repository, mailSender, service };
}

describe('organizer email verification service', () => {
  it('rotates a hashed token with a 24-hour expiry before sending the verification email', async () => {
    const { repository, mailSender, service } = setup();

    await expect(service.send({ eventId, sessionToken: 'admin-session' })).resolves.toEqual({
      status: 'sent',
    });
    expect(repository.prepareSend).toHaveBeenCalledWith({
      eventId,
      sessionTokenHash: 'hashed-admin-session',
      tokenHash: 'hashed-verification-token',
      sentAt: now,
      expiresAt: new Date('2026-11-04T12:00:00.000Z'),
    });
    expect(mailSender.send).toHaveBeenCalledWith(expect.objectContaining({
      to: 'owner@example.com',
      text: expect.stringContaining('raw-verification-token'),
    }));
    expect(JSON.stringify(vi.mocked(repository.prepareSend).mock.calls))
      .not.toContain('raw-verification-token');
  });

  it('does not send when the organizer email is already verified', async () => {
    const { mailSender, service } = setup({ status: 'already-verified' });

    await expect(service.send({ eventId, sessionToken: 'admin-session' })).resolves.toEqual({
      status: 'already-verified',
    });
    expect(mailSender.send).not.toHaveBeenCalled();
  });

  it('does not replace a provider failure with secret-bearing details', async () => {
    const { mailSender, service } = setup();
    vi.mocked(mailSender.send).mockRejectedValue(new Error('provider secret body'));

    await expect(service.send({ eventId, sessionToken: 'admin-session' })).rejects.toThrow(
      'provider secret body',
    );
  });

  it('hashes the public token and returns only the verified event id', async () => {
    const { repository, service } = setup();

    await expect(service.verify('raw-verification-token')).resolves.toEqual({
      eventId, status: 'verified',
    });
    expect(repository.verify).toHaveBeenCalledWith({
      tokenHash: 'hashed-verification-token',
      verifiedAt: now,
    });
  });

  it('uses one indistinguishable not-found error for invalid or expired tokens', async () => {
    const { repository, service } = setup();
    vi.mocked(repository.verify).mockResolvedValue(null);

    await expect(service.verify('unknown-token')).rejects.toBeInstanceOf(
      EmailVerificationNotFoundError,
    );
  });
});
