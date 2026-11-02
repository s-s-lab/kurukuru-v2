import type {
  AdminCandidateSlotsRequest,
  AdminEvent,
  AdminEventUpdateRequest,
  AdminFinalizationRequest,
} from './service';

export interface AdminRepository {
  findPasswordHash(eventId: string): Promise<string | null>;
  createSession(input: {
    eventId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<AdminEvent>;
  getAdminEvent(eventId: string, tokenHash: string): Promise<AdminEvent>;
  updateEvent(input: {
    eventId: string;
    tokenHash: string;
    request: AdminEventUpdateRequest;
  }): Promise<AdminEvent>;
  setEventStatus(input: {
    eventId: string;
    tokenHash: string;
    status: 'open' | 'closed';
  }): Promise<AdminEvent>;
  replaceCandidateSlots(input: {
    eventId: string;
    tokenHash: string;
    request: AdminCandidateSlotsRequest;
  }): Promise<AdminEvent>;
  setFinalization(input: {
    eventId: string;
    tokenHash: string;
    request: AdminFinalizationRequest;
  }): Promise<AdminEvent>;
  clearFinalization(input: {
    eventId: string;
    tokenHash: string;
  }): Promise<AdminEvent>;
  deleteEvent(input: {
    eventId: string;
    tokenHash: string;
  }): Promise<void>;
}
