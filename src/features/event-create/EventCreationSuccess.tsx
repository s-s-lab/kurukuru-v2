import { Check, Copy, ShieldCheck, TriangleAlert, Users } from 'lucide-react';
import { useState } from 'react';

type EventCreationSuccessProps = {
  participantUrl: string;
  organizerUrl: string;
  copyText: (text: string) => Promise<void>;
};

export function EventCreationSuccess({ participantUrl, organizerUrl, copyText }: EventCreationSuccessProps) {
  const [feedback, setFeedback] = useState('');

  async function copy(label: string, url: string) {
    setFeedback('');
    try {
      await copyText(url);
      setFeedback(`${label}をコピーしました。`);
    } catch {
      setFeedback('コピーできませんでした。URLを選択してコピーしてください。');
    }
  }

  return (
    <section className="event-success" aria-labelledby="success-heading">
      <div className="event-success-heading">
        <span className="event-success-check"><Check size={32} aria-hidden="true" /></span>
        <h2 id="success-heading" tabIndex={-1}>日程調整を作成しました</h2>
        <p>参加者にURLを共有して、回答を集めましょう。<br />回答状況は主催者用URLから確認できます。</p>
      </div>
      {[
        { label: '参加者用URL', url: participantUrl, Icon: Users, help: 'このURLを参加者に共有してください。', id: 'participant-url' },
        { label: '主催者用URL', url: organizerUrl, Icon: ShieldCheck, help: '回答の確認・編集に使用します。大切に保管してください。', id: 'organizer-url' },
      ].map(({ label, url, Icon, help, id }) => <div className="event-share" role="group" aria-labelledby={`${id}-label`} key={id}>
        <label id={`${id}-label`} htmlFor={id}><Icon size={22} aria-hidden="true" />{label}</label>
        <p id={`${id}-help`}>{help}</p>
        <div className="event-share-controls">
          <input id={id} value={url} readOnly aria-describedby={`${id}-help`} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="event-button event-button-secondary" onClick={() => { void copy(label, url); }}>
            <Copy size={16} aria-hidden="true" />URLをコピー
          </button>
        </div>
      </div>)}
      <div className="event-save-warning">
        <TriangleAlert size={21} aria-hidden="true" />
        <div><strong>主催者用URLは必ず保存してください</strong>
          <p>回答の確認・編集に必要です。参加者への共有には参加者用URLをお使いください。</p></div>
      </div>
      <p className="event-copy-status" role="status" aria-live="polite">{feedback}</p>
      <div className="event-actions event-success-actions">
        <a className="event-button event-button-primary" href="#/">トップへ戻る</a>
      </div>
    </section>
  );
}
