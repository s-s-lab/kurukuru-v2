import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CreatedEventHistory } from '../features/event-history/CreatedEventHistory';
import { readCreatedEventHistory, removeCreatedEventHistory, type CreatedEventHistoryItem } from '../features/event-history/event-history';

export function HomePage() {
  const [history, setHistory] = useState(readCreatedEventHistory);
  const [historyMessage, setHistoryMessage] = useState('');
  const main = useRef<HTMLElement>(null);
  const createLink = useRef<HTMLAnchorElement>(null);
  const pendingFocus = useRef<string | null | undefined>(undefined);

  useLayoutEffect(() => {
    if (pendingFocus.current === undefined) return;
    const target = Array.from(main.current?.querySelectorAll<HTMLButtonElement>('[data-history-event-id]') ?? [])
      .find((button) => button.dataset.historyEventId === pendingFocus.current);
    (target ?? createLink.current)?.focus();
    pendingFocus.current = undefined;
  }, [history]);

  function removeHistory(item: CreatedEventHistoryItem) {
    if (!window.confirm(`「${item.title}」をこのブラウザの履歴から削除しますか？\nイベントや回答は削除されません。回答ボードの「候補日時管理」へのリンクも表示されなくなるため、必要なURLは保存してください。`)) return;
    const remaining = removeCreatedEventHistory(item.eventId);
    if (!remaining) {
      setHistoryMessage('履歴から削除できませんでした。ブラウザの保存設定を確認して、もう一度お試しください。');
      return;
    }
    const index = history.findIndex(({ eventId }) => eventId === item.eventId);
    pendingFocus.current = remaining[Math.min(Math.max(index, 0), remaining.length - 1)]?.eventId ?? null;
    setHistory(remaining);
    setHistoryMessage(`「${item.title}」を履歴から削除しました。イベントや回答は残っています。`);
  }
  return (
    <main ref={main} className="compact-home shell">
      <section className="compact-home-intro" aria-labelledby="home-title">
        <div>
          <p>30分単位の日程調整ツール{'　'}―参加者が回答すると通知がくるくる！</p>
          <h1 id="home-title">候補時間を選んで、URLを共有。</h1>
          <span>登録不要。みんなの回答を、ひとつの公開ボードで比べられます。</span>
        </div>
        <Link ref={createLink} className="primary-action" to="/events/new">
          日程調整を作成 <ArrowRight size={18} aria-hidden="true" />
        </Link>
      </section>
      <section className="compact-home-preview" aria-label="回答ボードの表示例">
        <div className="compact-preview-head">
          <strong>回答ボード</strong>
          <span>◎ 希望 / ○ 参加可 / △ 未定 / × 不可</span>
        </div>
        <div className="compact-preview-table" aria-hidden="true">
          <b>11月18日（水）</b><b>06</b><b /><b>07</b><b /><b>08</b><b /><b>09</b><b />
          <strong>鈴木</strong><i className="is-best">◎</i><i className="is-best">◎</i><i className="is-ok">○</i><i className="is-ok">○</i><i className="is-ng">×</i><i className="is-ng">×</i><i className="is-ng">×</i><i className="is-ng">×</i>
          <strong>田中</strong><i className="is-maybe">△</i><i className="is-ok">○</i><i className="is-ok">○</i><i className="is-ok">○</i><i className="is-best">◎</i><i className="is-best">◎</i><i className="is-ok">○</i><i className="is-ng">×</i>
        </div>
      </section>
      <CreatedEventHistory items={history} onRemove={removeHistory} />
      <p className="created-event-history-status" role="status" aria-live="polite">{historyMessage}</p>
      <section className="service-notice" aria-labelledby="service-notice-heading">
        <h2 id="service-notice-heading">ご利用にあたって</h2>
        <ul>
          <li>個人利用を目的に、スケジュール調整ツール「<strong><a href="https://tonton.amaneku.com/addschedule.php"
            target="_blank" rel="noreferrer">トントン</a></strong>」を参考に開発し、トントンの開発元に対して公開の承諾を得たうえで公開しています。</li>
          <li>広告なし・無料で運営しており、収益は一切発生しません。</li>
          <li>セキュリティ上のトラブルについても一切責任を負いません。</li>
          <li>トントン後継サービス「Nextonton」は、本サービスとは異なる第三者が独立して運用するサービスで、本サービスとは一切関わりありません。</li>
        </ul>
      </section>
    </main>
  );
}
