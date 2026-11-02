import type { AdminEvent, AdminEventUpdateRequest } from './service';

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
}
