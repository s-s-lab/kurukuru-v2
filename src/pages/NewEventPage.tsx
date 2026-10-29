import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NewEventPage() {
  return (
    <main className="shell form-shell">
      <Link className="back-link" to="/">
        <ArrowLeft size={17} aria-hidden="true" />
        トップへ戻る
      </Link>
      <div className="page-heading">
        <p>イベント作成</p>
        <h1>日程調整を作成</h1>
        <span>まず基本情報を入力し、次に候補日と時間帯を選びます。</span>
      </div>
      <section className="form-panel" aria-label="イベント基本情報">
        <p className="phase-message">イベント作成フローはP4で実装します。</p>
      </section>
    </main>
  );
}

