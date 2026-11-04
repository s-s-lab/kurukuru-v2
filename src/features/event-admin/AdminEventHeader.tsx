import { Link2 } from 'lucide-react';

import type { AdminEvent } from '../../../functions/admin/service';

type Props = {
  event: AdminEvent;
  participantUrl: string;
  onShare: () => void;
  isSharing: boolean;
  shareMessage: string;
};

export function AdminEventHeader({ event, participantUrl, onShare, isSharing, shareMessage }: Props) {
  const isOpen = event.status === 'open';
  return <header className="admin-event-header">
    <div className="admin-event-title">
      <p>主催者用ページ</p>
      <h1>{event.title}</h1>
      <span className={isOpen ? 'is-open' : 'is-closed'}>
        <span aria-hidden="true">{isOpen ? '●' : '■'}</span>
        {isOpen ? '回答受付中' : '受付停止中'}
      </span>
    </div>
    <div className="admin-share-action">
      <label htmlFor="admin-participant-url">参加者用URL</label>
      <input id="admin-participant-url" type="text" readOnly value={participantUrl}
        onFocus={(focusEvent) => focusEvent.currentTarget.select()} />
      <button type="button" className="event-button event-button-secondary"
        onClick={onShare} disabled={isSharing}>
        <Link2 size={18} aria-hidden="true" />
        {isSharing ? '共有しています…' : '参加者用URLを共有'}
      </button>
      <p aria-live="polite">{shareMessage}</p>
    </div>
  </header>;
}
