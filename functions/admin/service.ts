import type {
  EventStatus,
  PublicCandidateSlot,
  PublicResponse,
} from '../events/service';

export type AdminEvent = {
  id: string;
  title: string;
  description: string;
  organizerEmail: string;
  organizerEmailVerified: boolean;
  notifyOnResponse: boolean;
  status: EventStatus;
  finalization: null | {
    date: string;
    startSlot: number;
    endSlot: number;
  };
  version: number;
  createdAt: string;
  updatedAt: string;
  candidateSlots: PublicCandidateSlot[];
  responses: PublicResponse[];
};

export type AdminEventUpdateRequest = {
  title: string;
  description: string;
  notifyOnResponse: boolean;
};

export type AdminSessionResult = {
  sessionToken: string;
  expiresAt: string;
  event: AdminEvent;
};

export class AdminAccessDeniedError extends Error {
  constructor() {
    super('Admin access was denied.');
    this.name = 'AdminAccessDeniedError';
  }
}

export interface AdminService {
  createSession(command: {
    eventId: string;
    password: string;
  }): Promise<AdminSessionResult>;
  getEvent(command: {
    eventId: string;
    sessionToken: string;
  }): Promise<AdminEvent>;
  updateEvent(command: {
    eventId: string;
    sessionToken: string;
    request: AdminEventUpdateRequest;
  }): Promise<AdminEvent>;
  closeEvent(command: {
    eventId: string;
    sessionToken: string;
  }): Promise<AdminEvent>;
  reopenEvent(command: {
    eventId: string;
    sessionToken: string;
  }): Promise<AdminEvent>;
}
