import { useState } from 'react';

type Props = {
  eventTitle: string;
  isDisabled: boolean;
  isDeleting: boolean;
  message: string;
  onDelete: () => void;
};

export function AdminDeleteControl({ eventTitle, isDisabled, isDeleting, message, onDelete }: Props) {
  const [confirmation, setConfirmation] = useState('');
  const matches = confirmation === eventTitle;

  return <section className="admin-delete-control" aria-labelledby="admin-delete-heading">
    <div className="admin-lifecycle-heading">
      <div><p>危険な操作</p><h2 id="admin-delete-heading">イベントを削除</h2></div>
      <p>参加者の回答を含むイベント全体を削除します。この操作は取り消せません。</p>
    </div>
    <div className="event-field">
      <label htmlFor="admin-delete-confirmation">確認のためイベント名を入力</label>
      <input id="admin-delete-confirmation" value={confirmation} autoComplete="off"
        aria-describedby="admin-delete-help"
        onChange={(event) => setConfirmation(event.target.value)} />
      <small id="admin-delete-help">「{eventTitle}」と入力すると削除できます。</small>
    </div>
    <p className="admin-operation-message" aria-live="polite">{message}</p>
    <button type="button" className="event-button admin-delete-button"
      disabled={!matches || isDisabled} onClick={onDelete}>
      {isDeleting ? '削除しています…' : 'イベントを削除'}
    </button>
  </section>;
}
