export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
};

export interface MailSender {
  send(message: MailMessage): Promise<{ providerMessageId: string }>;
}
