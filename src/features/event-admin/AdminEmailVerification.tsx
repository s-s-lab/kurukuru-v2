type Props = {
  verified: boolean;
  notifyOnResponse: boolean;
  isSending: boolean;
  isDisabled: boolean;
  message: string;
  onSend: () => void | Promise<void>;
};

export function AdminEmailVerification({
  verified,
  notifyOnResponse,
  isSending,
  isDisabled,
  message,
  onSend,
}: Props) {
  return <section className="admin-email-verification" aria-labelledby="admin-email-heading">
    <div className="admin-email-verification-copy">
      <p className="admin-email-eyebrow">通知用メールアドレス</p>
      <div className="admin-email-title-row">
        <h2 id="admin-email-heading">主催者メールの確認</h2>
        <span className={verified ? 'admin-email-badge is-verified' : 'admin-email-badge'}>
          {verified ? '確認済み' : '未確認'}
        </span>
      </div>
      {verified
        ? <p>メールアドレスの確認が完了しています。</p>
        : <p>確認が完了するまで回答通知は送信されません。</p>}
      {!notifyOnResponse && <p className="admin-email-note">
        現在、回答通知はオフです。基本情報からオンにすると、確認完了後に通知が始まります。
      </p>}
      <p className="admin-operation-message" aria-live="polite">{message}</p>
    </div>
    {!verified && <button type="button" className="event-button event-button-secondary"
      disabled={isDisabled || isSending} onClick={() => void onSend()}>
      {isSending ? '送信しています…' : '確認メールを送信'}
    </button>}
  </section>;
}
