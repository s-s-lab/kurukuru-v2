import { createHash } from 'node:crypto';

import type { MailMessage } from './service';

const footerText = 'このメールアドレスは送信専用です。返信いただいても確認できません。';
const footerHtml = `<p style="color:#526173;font-size:13px">${footerText}</p>`;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function appUrl(publicBaseUrl: string, hashPath: string): string {
  const root = publicBaseUrl.replace(/#.*$/, '').replace(/\/+$/, '');
  return `${root}/#/${hashPath.replace(/^\/+/, '')}`;
}

export function verificationMail(input: {
  eventId: string;
  eventTitle: string;
  organizerEmail: string;
  token: string;
  publicBaseUrl: string;
}): MailMessage {
  const link = appUrl(
    input.publicBaseUrl,
    `email-verifications/${encodeURIComponent(input.token)}`,
  );
  const safeTitle = escapeHtml(input.eventTitle);
  const idempotencySuffix = createHash('sha256').update(input.token).digest('hex').slice(0, 24);
  return {
    to: input.organizerEmail,
    subject: '【Kurukuru】主催者メールアドレスを確認してください',
    idempotencyKey: `verification-${input.eventId}-${idempotencySuffix}`,
    text: [
      `「${input.eventTitle}」の主催者メールアドレスを確認します。`,
      '',
      link,
      '',
      'このリンクは24時間有効です。',
      'このメールに心当たりがない場合は破棄してください。',
      footerText,
    ].join('\n'),
    html: [
      '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#102a43;line-height:1.7">',
      '<h1 style="font-size:20px">主催者メールアドレスの確認</h1>',
      `<p>「${safeTitle}」の主催者メールアドレスを確認します。</p>`,
      `<p><a href="${escapeHtml(link)}" style="display:inline-block;background:#087f8c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">メールアドレスを確認する</a></p>`,
      '<p>このリンクは24時間有効です。<br>心当たりがない場合は、このメールを破棄してください。</p>',
      footerHtml,
      '</div>',
    ].join(''),
  };
}

export function responseNotificationMail(input: {
  eventId: string;
  eventTitle: string;
  organizerEmail: string;
  respondentName: string;
  kind: 'created' | 'updated';
  publicBaseUrl: string;
  idempotencyKey: string;
}): MailMessage {
  const publicBoardLink = appUrl(input.publicBaseUrl, `events/${input.eventId}`);
  const created = input.kind === 'created';
  const subject = created
    ? `【Kurukuru】「${input.eventTitle}」に回答が届きました`
    : `【Kurukuru】「${input.eventTitle}」の回答が更新されました`;
  const action = created ? 'から回答が届きました。' : 'が回答を更新しました。';
  return {
    to: input.organizerEmail,
    subject,
    idempotencyKey: input.idempotencyKey,
    text: [
      `「${input.eventTitle}」に、${input.respondentName}さん${action}`,
      '',
      '回答内容は公開回答ボードで確認してください。',
      publicBoardLink,
      '',
      footerText,
    ].join('\n'),
    html: [
      '<div style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#102a43;line-height:1.7">',
      `<h1 style="font-size:20px">${created ? '新しい回答が届きました' : '回答が更新されました'}</h1>`,
      `<p>「${escapeHtml(input.eventTitle)}」に、${escapeHtml(input.respondentName)}さん${action}</p>`,
      '<p>回答内容は公開回答ボードで確認してください。</p>',
      `<p><a href="${escapeHtml(publicBoardLink)}" style="display:inline-block;background:#087f8c;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">公開回答ボードを開く</a></p>`,
      footerHtml,
      '</div>',
    ].join(''),
  };
}
