export type PreparedVerificationSend =
  | { status: 'already-verified' }
  | { status: 'ready'; eventTitle: string; organizerEmail: string };

export class EmailVerificationNotFoundError extends Error {
  constructor() {
    super('Email verification token was not found.');
    this.name = 'EmailVerificationNotFoundError';
  }
}

export interface EmailVerificationRepository {
  prepareSend(input: {
    eventId: string;
    sessionTokenHash: string;
    tokenHash: string;
    sentAt: Date;
    expiresAt: Date;
  }): Promise<PreparedVerificationSend>;
  verify(input: {
    tokenHash: string;
    verifiedAt: Date;
  }): Promise<{ eventId: string } | null>;
}
