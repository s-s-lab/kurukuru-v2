export type NotificationDrainResult = {
  processed: number;
  sent: number;
  failed: number;
};

export interface NotificationDispatcher {
  drain(limit: number): Promise<NotificationDrainResult>;
}
