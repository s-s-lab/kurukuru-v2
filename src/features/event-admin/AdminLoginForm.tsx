import { type FormEvent, useState } from 'react';
import { KeyRound } from 'lucide-react';

type Props = {
  onSubmit: (password: string) => void | Promise<void>;
  isSubmitting: boolean;
  errorMessage: string;
  requestId: string;
};

export function AdminLoginForm({ onSubmit, isSubmitting, errorMessage, requestId }: Props) {
  const [password, setPassword] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!password || isSubmitting) return;
    try {
      await onSubmit(password);
    } finally {
      setPassword('');
    }
  }

  return <main className="admin-login-page">
    <div className="shell admin-login-layout">
      <div className="admin-login-intro">
        <p>主催者用ページ</p>
        <h1>イベントを管理する</h1>
        <p>回答状況の確認や、イベント情報・回答受付状態の変更ができます。</p>
      </div>
      <form className="admin-login-form" onSubmit={submit}>
        <div className="admin-login-icon" aria-hidden="true"><KeyRound size={26} /></div>
        <h2>管理用パスワードを入力</h2>
        <p>イベント作成時に設定したパスワードを入力してください。</p>
        <div className="event-field">
          <label htmlFor="admin-password">管理用パスワード</label>
          <input id="admin-password" type="password" autoComplete="current-password"
            value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {errorMessage && <div className="admin-form-error" role="alert">
          <p>{errorMessage}</p>
          {requestId && <small>お問い合わせID: {requestId}</small>}
        </div>}
        <button className="event-button event-button-primary admin-login-submit" type="submit"
          disabled={isSubmitting || !password}>
          {isSubmitting ? '確認しています…' : '管理画面を開く'}
        </button>
        <small className="admin-login-note">パスワードはこの端末に保存しません。</small>
      </form>
    </div>
  </main>;
}
