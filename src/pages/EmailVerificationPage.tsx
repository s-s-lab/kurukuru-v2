import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { AdminApiError, verifyOrganizerEmail } from '../features/event-admin/admin-api';

type Props = {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
};

type State =
  | { kind: 'checking' }
  | { kind: 'verified'; eventId: string }
  | { kind: 'invalid' }
  | { kind: 'retryable' };

export function EmailVerificationPage({ apiBaseUrl, fetcher }: Props) {
  const { token = '' } = useParams();
  return <EmailVerificationPageState key={token} token={token}
    apiBaseUrl={apiBaseUrl} fetcher={fetcher} />;
}

function EmailVerificationPageState({ apiBaseUrl, fetcher, token }: Props & { token: string }) {
  const [state, setState] = useState<State>({ kind: 'checking' });

  useEffect(() => {
    let active = true;
    verifyOrganizerEmail(token, { apiBaseUrl, fetcher })
      .then((result) => {
        if (active) setState({ kind: 'verified', eventId: result.eventId });
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof AdminApiError
          && error.code === 'EMAIL_VERIFICATION_NOT_FOUND'
          ? { kind: 'invalid' }
          : { kind: 'retryable' });
      });
    return () => { active = false; };
  }, [apiBaseUrl, fetcher, token]);

  if (state.kind === 'checking') {
    return <main className="shell verification-page-state">
      <p className="verification-kicker">Kurukuru</p>
      <h1>メールアドレスを確認しています…</h1>
      <p>そのまま少しお待ちください。</p>
    </main>;
  }
  if (state.kind === 'verified') {
    return <main className="shell verification-page-state is-success">
      <p className="verification-kicker">確認完了</p>
      <h1>メールアドレスを確認しました</h1>
      <p>回答通知をオンにしている場合、新しい回答や更新を送信専用アドレスからお知らせします。</p>
      <a className="event-button event-button-primary"
        href={`#/events/${encodeURIComponent(state.eventId)}/admin`}>主催者画面を開く</a>
    </main>;
  }
  if (state.kind === 'invalid') {
    return <main className="shell verification-page-state">
      <p className="verification-kicker">リンクエラー</p>
      <h1>この確認リンクは利用できません</h1>
      <p>リンクが無効か、24時間の有効期限が切れています。主催者画面から確認メールを再送してください。</p>
      <a className="event-button event-button-secondary" href="#/">トップへ戻る</a>
    </main>;
  }
  return <main className="shell verification-page-state">
    <p className="verification-kicker">一時的なエラー</p>
    <h1>確認を完了できませんでした</h1>
    <p>時間をおいてページを再読み込みしてください。解決しない場合は主催者画面から確認メールを再送してください。</p>
  </main>;
}
