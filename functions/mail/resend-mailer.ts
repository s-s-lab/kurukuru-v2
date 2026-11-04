import type { MailMessage, MailSender } from './service';

export type MailDeliveryErrorCategory =
  | 'network-failure'
  | 'provider-rejected'
  | 'invalid-provider-response';

export class MailDeliveryError extends Error {
  readonly category: MailDeliveryErrorCategory;

  constructor(category: MailDeliveryErrorCategory) {
    super('The email provider could not deliver the message.');
    this.name = 'MailDeliveryError';
    this.category = category;
  }
}

export class ResendMailer implements MailSender {
  private readonly apiKey: string;
  private readonly from: string;
  private readonly fetcher: typeof fetch;

  constructor(options: { apiKey: string; from: string; fetcher?: typeof fetch }) {
    this.apiKey = options.apiKey;
    this.from = options.from;
    this.fetcher = options.fetcher ?? fetch;
  }

  async send(message: MailMessage): Promise<{ providerMessageId: string }> {
    let response: Response;
    try {
      response = await this.fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch {
      throw new MailDeliveryError('network-failure');
    }

    if (!response.ok) {
      throw new MailDeliveryError('provider-rejected');
    }

    const body: unknown = await response.json().catch(() => undefined);
    if (!body || typeof body !== 'object' || !('id' in body) || typeof body.id !== 'string') {
      throw new MailDeliveryError('invalid-provider-response');
    }
    return { providerMessageId: body.id };
  }
}
