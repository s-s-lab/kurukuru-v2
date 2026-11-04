export type EventStatus = 'open' | 'closed';
export type AvailabilityMark = 'best' | 'ok' | 'maybe' | 'ng';

export type PublicCandidateSlot = {
  id: string;
  date: string;
  slotIndex: number;
};

export type PublicResponse = {
  id: string;
  displayName: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  availability: Array<{
    candidateSlotId: string;
    mark: AvailabilityMark;
  }>;
};

export type PublicEvent = {
  id: string;
  title: string;
  description: string;
  status: EventStatus;
  finalization: null | {
    date: string;
    startSlot: number;
    endSlot: number;
  };
  createdAt: string;
  updatedAt: string;
  candidateSlots: PublicCandidateSlot[];
  responses: PublicResponse[];
};

export type CreateEventCommand = {
  idempotencyKey: string;
  request: {
    title: string;
    description: string;
    organizerEmail: string;
    adminPassword: string;
    notifyOnResponse: boolean;
    candidateSlots: Array<{
      date: string;
      slotIndexes: number[];
    }>;
  };
};

export type CreateEventResult = {
  event: PublicEvent;
  emailVerificationRequired: true;
};

export interface EventService {
  createEvent(command: CreateEventCommand): Promise<CreateEventResult>;
  getPublicEvent(eventId: string): Promise<PublicEvent | null>;
}
