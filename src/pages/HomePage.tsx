import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { CreatedEventHistory } from '../features/event-history/CreatedEventHistory';
import { readCreatedEventHistory } from '../features/event-history/event-history';

export function HomePage() {
  const history = readCreatedEventHistory();
  return (
    <main className="compact-home shell">
      <section className="compact-home-intro" aria-labelledby="home-title">
        <div>
          <p>30分単位の日程調整ツール{'　'}―参加者が回答すると通知がくるくる！</p>
          <h1 id="home-title">候補時間を選んで、URLを共有。</h1>
          <span>登録不要。みんなの回答を、ひとつの公開ボードで比べられます。</span>
        </div>
        <Link className="primary-action" to="/events/new">
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
      <CreatedEventHistory items={history} />
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
