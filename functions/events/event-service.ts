import { createHash } from 'node:crypto';

import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
} from '../security/secrets';
import type { EventRepository } from './repository';
import type { CreateEventCommand, EventService } from './service';

type EventServiceDependencies = {
  hashPassword: (password: string) => Promise<string>;
  generateToken: () => string;
  hashToken: (token: string) => string;
  now: () => Date;
};

const defaultDependencies: EventServiceDependencies = {
  hashPassword,
  generateToken: generateOpaqueToken,
  hashToken: hashOpaqueToken,
  now: () => new Date(),
};

function hashRequest(request: CreateEventCommand['request']): string {
  return createHash('sha256').update(JSON.stringify(request), 'utf8').digest('hex');
}

export function createEventService(
  repository: EventRepository,
  dependencyOverrides: Partial<EventServiceDependencies> = {},
): EventService {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };

  return {
    async createEvent(command) {
      const [adminSecretHash, verificationToken] = await Promise.all([
        dependencies.hashPassword(command.request.adminPassword),
        Promise.resolve(dependencies.generateToken()),
      ]);
      const createdAt = dependencies.now();
      const expiresAt = new Date(createdAt.getTime() + 24 * 60 * 60 * 1000);

      return repository.createEvent({
        idempotencyKey: command.idempotencyKey,
        requestHash: hashRequest(command.request),
        event: {
          title: command.request.title,
          description: command.request.description,
          organizerEmail: command.request.organizerEmail,
          adminSecretHash,
          notifyOnResponse: command.request.notifyOnResponse,
        },
        candidateSlots: command.request.candidateSlots.flatMap((candidate) =>
          candidate.slotIndexes.map((slotIndex) => ({ date: candidate.date, slotIndex })),
        ),
        emailVerification: {
          tokenHash: dependencies.hashToken(verificationToken),
          expiresAt,
        },
      });
    },

    getPublicEvent(eventId) {
      return repository.getPublicEvent(eventId);
    },
  };
}
