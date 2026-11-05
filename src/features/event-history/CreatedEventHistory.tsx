import { CalendarDays, Settings2 } from 'lucide-react';

import type { CreatedEventHistoryItem } from './event-history';

function formatCreatedAt(createdAt: string) {
  const value = new Date(createdAt);
  if (Number.isNaN(value.getTime())) return '';
  return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric' }).format(value);
}

export function CreatedEventHistory({ items }: { items: CreatedEventHistoryItem[] }) {
  if (items.length === 0) return null;
  return <section className="created-event-history" aria-label="このブラウザで作成したイベント">
    <div className="created-event-history-heading">
      <h2>作成したイベント</h2><span>このブラウザの直近{items.length}件</span>
    </div>
    <ul>{items.map((item) => <li key={item.eventId}>
      <div><strong>{item.title}</strong><small>{formatCreatedAt(item.createdAt)} 作成</small></div>
      <nav aria-label={`${item.title}のリンク`}>
        <a href={item.participantUrl}><CalendarDays size={15} aria-hidden="true" />回答ボード</a>
        <a href={item.organizerUrl}><Settings2 size={15} aria-hidden="true" />候補日時管理</a>
      </nav>
    </li>)}</ul>
  </section>;
}
