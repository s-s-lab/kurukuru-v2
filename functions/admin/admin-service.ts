import {
  generateOpaqueToken,
  hashOpaqueToken,
  verifyPassword,
} from '../security/secrets';
import type { AdminRepository } from './repository';
import {
  AdminAccessDeniedError,
  type AdminService,
} from './service';

export { AdminAccessDeniedError } from './service';

const SESSION_DURATION_MS = 12 * 60 * 60 * 1_000;

type AdminServiceDependencies = {
  now: () => Date;
  verifyPassword: (password: string, encoded: string) => Promise<boolean>;
  generateToken: () => string;
  hashToken: (token: string) => string;
};

const defaultDependencies: AdminServiceDependencies = {
  now: () => new Date(),
  verifyPassword,
  generateToken: generateOpaqueToken,
  hashToken: hashOpaqueToken,
};

export function createAdminService(
  repository: AdminRepository,
  dependencyOverrides: Partial<AdminServiceDependencies> = {},
): AdminService {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  function tokenHash(sessionToken: string): string {
    return dependencies.hashToken(sessionToken);
  }

  return {
    async createSession(command) {
      const passwordHash = await repository.findPasswordHash(command.eventId);
      if (!passwordHash || !(await dependencies.verifyPassword(command.password, passwordHash))) {
        throw new AdminAccessDeniedError();
      }

      const sessionToken = dependencies.generateToken();
      const expiresAt = new Date(dependencies.now().getTime() + SESSION_DURATION_MS);
      const event = await repository.createSession({
        eventId: command.eventId,
        tokenHash: tokenHash(sessionToken),
        expiresAt,
      });
      return { sessionToken, expiresAt: expiresAt.toISOString(), event };
    },

    getEvent(command) {
      return repository.getAdminEvent(command.eventId, tokenHash(command.sessionToken));
    },

    updateEvent(command) {
      return repository.updateEvent({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
        request: command.request,
      });
    },

    closeEvent(command) {
      return repository.setEventStatus({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
        status: 'closed',
      });
    },

    reopenEvent(command) {
      return repository.setEventStatus({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
        status: 'open',
      });
    },

    replaceCandidateSlots(command) {
      return repository.replaceCandidateSlots({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
        request: command.request,
      });
    },

    setFinalization(command) {
      return repository.setFinalization({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
        request: command.request,
      });
    },

    clearFinalization(command) {
      return repository.clearFinalization({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
      });
    },

    deleteEvent(command) {
      return repository.deleteEvent({
        eventId: command.eventId,
        tokenHash: tokenHash(command.sessionToken),
      });
    },
  };
}
