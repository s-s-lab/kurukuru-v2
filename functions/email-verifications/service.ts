export type EmailVerificationSendResult = {
  status: 'sent' | 'already-verified';
};

export type EmailVerificationResult = {
  eventId: string;
  status: 'verified';
};

export interface EmailVerificationService {
  send(command: {
    eventId: string;
    sessionToken: string;
  }): Promise<EmailVerificationSendResult>;
  verify(token: string): Promise<EmailVerificationResult>;
}
