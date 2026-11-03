import type { EventStatus } from '../../../functions/events/service';

type Props = {
  status: EventStatus;
  onClose: () => void | Promise<void>;
  onReopen: () => void | Promise<void>;
  isChanging: boolean;
  isDisabled?: boolean;
  message: string;
};

export function AdminEventStatusControl({ status, onClose, onReopen, isChanging,
  isDisabled = false, message }: Props) {
  const isOpen = status === 'open';
  return <section className="admin-status-control" aria-labelledby="admin-status-heading">
    <h2 id="admin-status-heading">回答受付</h2>
    <p>{isOpen
      ? '停止後も、いつでも回答受付を再開できます。'
      : '再開すると、参加者が回答を保存・更新できるようになります。'}</p>
    <p className="admin-operation-message" aria-live="polite">{message}</p>
    <button className="event-button event-button-secondary" type="button"
      disabled={isDisabled || isChanging} onClick={() => void (isOpen ? onClose() : onReopen())}>
      {isChanging ? '変更しています…' : isOpen ? '回答受付を停止' : '回答受付を再開'}
    </button>
  </section>;
}
