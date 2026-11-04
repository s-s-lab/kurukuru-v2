export type ClaimedNotification = {
  id: string;
  eventId: string;
  eventTitle: string;
  organizerEmail: string;
  responseId: string;
  respondentName: string;
  kind: 'created' | 'updated';
  attempts: number;
  idempotencyKey: string;
};

export interface NotificationRepository {
  claim(limit: number): Promise<ClaimedNotification[]>;
  markSent(notificationId: string, providerMessageId: string): Promise<void>;
  markFailed(notificationId: string, errorCategory: string): Promise<void>;
}
