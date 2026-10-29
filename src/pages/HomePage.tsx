import { ArrowRight, Clock3, Link2, MousePointer2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const steps = [
  { icon: Clock3, title: '候補時間をつくる', body: '6:00〜24:00を30分単位で選べます。' },
  { icon: Link2, title: 'URLを共有する', body: '参加者の登録やログインは不要です。' },
  { icon: MousePointer2, title: 'なぞって回答する', body: '◎・○・△・×をまとめて入力できます。' },
];

export function HomePage() {
  return (
    <main>
      <section className="hero shell" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="hero-context">30分単位の日程調整ツール</p>
          <h1 id="hero-title">時間帯をなぞるだけ。</h1>
          <p className="hero-lead">
            候補日ごとに時間を選び、URLを送るだけ。みんなの予定をひとつの時間軸で比べられます。
          </p>
          <Link className="primary-action" to="/events/new">
            日程調整を作成
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <p className="hero-note">アカウント登録不要・無料で利用開始</p>
        </div>

        <div className="timeline-preview" aria-label="時間帯選択のイメージ">
          <div className="preview-head">
            <div>
              <span className="preview-date">11月12日（水）</span>
              <span className="preview-caption">候補時間</span>
            </div>
            <span className="preview-status">選択中</span>
          </div>
          <div className="preview-times" aria-hidden="true">
            {['9:00', '9:30', '10:00', '10:30', '11:00', '11:30'].map((time) => (
              <span key={time}>{time}</span>
            ))}
          </div>
          <div className="preview-cells" aria-hidden="true">
            {[0, 1, 2, 3, 4, 5].map((cell) => (
              <span className={cell >= 1 && cell <= 4 ? 'is-selected' : ''} key={cell} />
            ))}
          </div>
          <div className="preview-legend">
            <span><b className="mark mark-best">◎</b>希望</span>
            <span><b className="mark mark-ok">○</b>参加可</span>
            <span><b className="mark mark-maybe">△</b>未定</span>
            <span><b className="mark mark-ng">×</b>不可</span>
          </div>
        </div>
      </section>

      <section className="how-it-works shell" aria-labelledby="how-title">
        <div className="section-heading">
          <h2 id="how-title">3つの手順で調整完了</h2>
          <p>予定が日によって違っても、同じ画面で迷わず回答できます。</p>
        </div>
        <ol className="step-list">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title}>
              <span className="step-number">{index + 1}</span>
              <Icon size={22} aria-hidden="true" />
              <div>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}

