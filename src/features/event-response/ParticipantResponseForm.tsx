import { CalendarDays, Share2, Users } from 'lucide-react';

import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import type { ResponseDraft } from './response-model';
import { AvailabilityResponseGrid } from './AvailabilityResponseGrid';

type Props = {
  event: PublicEvent;
  draft: ResponseDraft;
  selectedMark: AvailabilityMark;
  onSelectedMarkChange: (mark: AvailabilityMark) => void;
  onDraftChange: (field: 'displayName' | 'comment', value: string) => void;
  onPaint: (slotIds: string[], mark: AvailabilityMark) => void;
  onSubmit: () => void;
  onShare: () => void;
  isSubmitting: boolean;
  ownsResponse: boolean;
  saveMessage: string;
};

function dateRange(event: PublicEvent) {
  const dates = [...new Set(event.candidateSlots.map(({ date }) => date))].sort();
  const format = (date: string) => {
    const [, month, day] = date.split('-');
    return `${Number(month)}月${Number(day)}日`;
  };
  if (!dates.length) return '候補日時なし';
  return dates.length === 1 ? format(dates[0]) : `${format(dates[0])}〜${format(dates.at(-1)!)}`;
}

export function ParticipantResponseForm(props: Props) {
  const { event, draft, selectedMark, onSelectedMarkChange, onDraftChange, onPaint,
    onSubmit, onShare, isSubmitting, ownsResponse, saveMessage } = props;
  const closed = event.status === 'closed';
  const invalidName = draft.displayName.trim().length < 1 || draft.displayName.trim().length > 80;

  return <>
    <main className="participant-page">
      <section className="participant-summary shell">
        <div>
          <h1>{event.title}</h1>
          {event.description ? <p>{event.description}</p> : null}
          <div className="participant-meta">
            <strong className={closed ? 'is-closed' : ''}>{closed ? '回答受付終了' : '回答受付中'}</strong>
            <span><CalendarDays size={18} aria-hidden="true" />候補日 {dateRange(event)}</span>
            <span><Users size={18} aria-hidden="true" />主催者：非公開</span>
          </div>
        </div>
        <div className="participant-finalization">
          <strong>確定した日時</strong>
          <CalendarDays size={28} aria-hidden="true" />
          {event.finalization
            ? <span>{event.finalization.date}</span>
            : <><span>まだ日時は確定していません</span><small>みなさんの回答をもとに、後日決定されます。</small></>}
        </div>
        <button type="button" className="participant-share-button" onClick={onShare}>
          <Share2 size={19} aria-hidden="true" />共有する
        </button>
      </section>

      <section className="participant-identity">
        <div className="shell participant-identity-inner">
          <div className="participant-field">
            <label htmlFor="participant-name">お名前 <span>必須</span></label>
            <input id="participant-name" value={draft.displayName} maxLength={80}
              autoComplete="name" aria-invalid={invalidName}
              onChange={(value) => onDraftChange('displayName', value.target.value)} />
          </div>
          <div className="participant-field">
            <label htmlFor="participant-comment">コメント（任意）</label>
            <textarea id="participant-comment" value={draft.comment} maxLength={1000}
              placeholder="例：この時間は調整しやすいです"
              onChange={(value) => onDraftChange('comment', value.target.value)} />
            <small>{draft.comment.length}/1000</small>
          </div>
        </div>
      </section>

      <div className="shell participant-workspace">
        <AvailabilityResponseGrid event={event} availability={draft.availability}
          selectedMark={selectedMark} onSelectedMarkChange={onSelectedMarkChange} onPaint={onPaint} />
        <p className="participant-save-message" role="status" aria-live="polite">
          {closed ? '回答受付は終了しています' : saveMessage || (ownsResponse ? '保存済みの回答を編集中です' : 'まだ保存されていません')}
        </p>
      </div>
    </main>
    <div className="participant-save-bar">
      <div className="shell">
        <a href="#/">キャンセル</a>
        <button type="button" onClick={onSubmit}
          disabled={closed || isSubmitting || invalidName}>
          {isSubmitting ? '保存中…' : ownsResponse ? '回答を更新' : '回答を保存'}
        </button>
      </div>
    </div>
  </>;
}
