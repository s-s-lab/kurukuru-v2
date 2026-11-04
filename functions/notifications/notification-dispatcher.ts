import { MailDeliveryError } from '../mail/resend-mailer';
import type { MailSender } from '../mail/service';
import { responseNotificationMail } from '../mail/templates';
import type { NotificationRepository } from './repository';
import type { NotificationDispatcher } from './service';

export function createNotificationDispatcher(config: {
  repository: NotificationRepository;
  mailSender: MailSender;
  publicBaseUrl: string;
}): NotificationDispatcher {
  return {
    async drain(limit) {
      const notifications = await config.repository.claim(limit);
      let sent = 0;
      let failed = 0;
      for (const notification of notifications) {
        try {
          const delivery = await config.mailSender.send(responseNotificationMail({
            eventId: notification.eventId,
            eventTitle: notification.eventTitle,
            organizerEmail: notification.organizerEmail,
            respondentName: notification.respondentName,
            kind: notification.kind,
            publicBaseUrl: config.publicBaseUrl,
            idempotencyKey: notification.idempotencyKey,
          }));
          await config.repository.markSent(notification.id, delivery.providerMessageId);
          sent += 1;
        } catch (error) {
          const category = error instanceof MailDeliveryError
            ? error.category
            : 'unexpected-mail-error';
          await config.repository.markFailed(notification.id, category);
          failed += 1;
        }
      }
      return { processed: notifications.length, sent, failed };
    },
  };
}
