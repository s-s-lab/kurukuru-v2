import type { CreateEventResult, PublicEvent } from './service';

export type CreateEventPersistenceInput = {
  idempotencyKey: string;
  requestHash: string;
  event: {
    title: string;
    description: string;
    duration: string;
    organizerEmail: string;
    adminSecretHash: string;
    notifyOnResponse: boolean;
  };
  candidateSlots: Array<{
    date: string;
    slotIndex: number;
  }>;
  emailVerification: {
    tokenHash: string;
    expiresAt: Date;
  };
};

export type CreateEventPersistenceResult = CreateEventResult & {
  created: boolean;
};

export interface EventRepository {
  createEvent(input: CreateEventPersistenceInput): Promise<CreateEventPersistenceResult>;
  getPublicEvent(eventId: string): Promise<PublicEvent | null>;
}
