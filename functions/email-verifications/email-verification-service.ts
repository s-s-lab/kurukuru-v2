import { generateOpaqueToken, hashOpaqueToken } from '../security/secrets';
import type { MailSender } from '../mail/service';
import { verificationMail } from '../mail/templates';
import {
  EmailVerificationNotFoundError,
  type EmailVerificationRepository,
} from './repository';
import type { EmailVerificationService } from './service';

const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1_000;

type Dependencies = {
  now: () => Date;
  generateToken: () => string;
  hashToken: (token: string) => string;
};

const defaultDependencies: Dependencies = {
  now: () => new Date(),
  generateToken: generateOpaqueToken,
  hashToken: hashOpaqueToken,
};

export function createEmailVerificationService(
  config: {
    repository: EmailVerificationRepository;
    mailSender: MailSender;
    publicBaseUrl: string;
  },
  overrides: Partial<Dependencies> = {},
): EmailVerificationService {
  const dependencies = { ...defaultDependencies, ...overrides };

  return {
    async send(command) {
      const sentAt = dependencies.now();
      const token = dependencies.generateToken();
      const prepared = await config.repository.prepareSend({
        eventId: command.eventId,
        sessionTokenHash: dependencies.hashToken(command.sessionToken),
        tokenHash: dependencies.hashToken(token),
        sentAt,
        expiresAt: new Date(sentAt.getTime() + VERIFICATION_LIFETIME_MS),
      });
      if (prepared.status === 'already-verified') {
        return { status: 'already-verified' };
      }
      await config.mailSender.send(verificationMail({
        eventId: command.eventId,
        eventTitle: prepared.eventTitle,
        organizerEmail: prepared.organizerEmail,
        token,
        publicBaseUrl: config.publicBaseUrl,
      }));
      return { status: 'sent' };
    },

    async verify(token) {
      const result = await config.repository.verify({
        tokenHash: dependencies.hashToken(token),
        verifiedAt: dependencies.now(),
      });
      if (!result) throw new EmailVerificationNotFoundError();
      return { eventId: result.eventId, status: 'verified' };
    },
  };
}
