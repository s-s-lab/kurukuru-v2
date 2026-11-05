import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

import { EventCreateFlow } from '../features/event-create/EventCreateFlow';

export function NewEventPage() {
  const today = new Date();
  const currentDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  return (
    <main className="shell form-shell">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        トップへ戻る
      </Link>
      <div className="page-heading">
        <p>イベント作成</p>
        <h1>日程調整を作成</h1>
        <span>基本情報、候補日、時間帯をこの画面でまとめて設定します。</span>
      </div>
      <EventCreateFlow today={currentDate} apiBaseUrl={import.meta.env.VITE_API_BASE_URL || '/api/v1'} location={window.location} />
    </main>
  );
}

