import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function HomePage() {
  return (
    <main className="compact-home shell">
      <section className="compact-home-intro" aria-labelledby="home-title">
        <div>
          <p>30分単位の日程調整</p>
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
          <b>回答者</b><b>10:00</b><b>10:30</b><b>11:00</b><b>11:30</b>
          <strong>鈴木</strong><i className="is-best">◎</i><i className="is-best">◎</i><i className="is-ok">○</i><i className="is-ng">×</i>
          <strong>田中</strong><i className="is-maybe">△</i><i className="is-ok">○</i><i className="is-ok">○</i><i className="is-ok">○</i>
        </div>
      </section>
    </main>
  );
}
