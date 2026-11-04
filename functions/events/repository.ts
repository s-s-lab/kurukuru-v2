import type { CreateEventResult, PublicEvent } from './service';

export type CreateEventPersistenceInput = {
  idempotencyKey: string;
  requestHash: string;
  event: {
    title: string;
    description: string;
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

export interface EventRepository {
  createEvent(input: CreateEventPersistenceInput): Promise<CreateEventResult>;
  getPublicEvent(eventId: string): Promise<PublicEvent | null>;
}
