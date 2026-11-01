import { formatSlotEnd, formatSlotStart, normalizeSlotIndexes } from '../../domain/slots';
import type { EventDraft } from './event-draft';

type ConfirmationStepProps = {
  draft: Pick<EventDraft, 'title' | 'description' | 'organizerEmail' | 'notifyOnResponse' | 'candidateDays'>;
  pending: boolean;
  error?: { message: string; requestId?: string };
  onBack: () => void;
  onSubmit: () => void;
};

function timeRanges(slotIndexes: number[]) {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const slot of normalizeSlotIndexes(slotIndexes)) {
    const last = ranges.at(-1);
    if (last && slot === last.end + 1) last.end = slot;
    else ranges.push({ start: slot, end: slot });
  }
  return ranges.map(({ start, end }) => `${formatSlotStart(start)}〜${formatSlotEnd(end)}`);
}

export function ConfirmationStep({ draft, pending, error, onBack, onSubmit }: ConfirmationStepProps) {
  return (
    <section className="event-confirmation" aria-labelledby="confirm-heading" aria-busy={pending}>
      <div className="event-step-heading">
        <h2 id="confirm-heading" tabIndex={-1}>内容を確認してください</h2>
        <p>以下の内容で日程調整を作成します。</p>
      </div>
      <dl className="event-summary">
        <div><dt>イベント名</dt><dd>{draft.title.trim()}</dd></div>
        <div><dt>説明</dt><dd>{draft.description.trim() || '説明なし'}</dd></div>
        <div><dt>主催者メールアドレス</dt><dd>{draft.organizerEmail.trim().toLowerCase()}</dd></div>
        <div><dt>回答時にメールで通知</dt><dd>{draft.notifyOnResponse ? '通知する' : '通知しない'}</dd></div>
      </dl>
      <h3 className="event-summary-heading">候補日時</h3>
      <dl className="event-summary event-summary-dates">
        {[...draft.candidateDays].sort((left, right) => left.date.localeCompare(right.date)).map((day) => {
          const [year, month, date] = day.date.split('-').map(Number);
          const label = `${year}年${month}月${date}日`;
          return <div key={day.date}>
            <dt><time dateTime={day.date}>{label}</time></dt>
            <dd><ul aria-label={`${label}の候補時間`}>
              {timeRanges(day.slotIndexes).map((range) => <li key={range}>{range}</li>)}
            </ul></dd>
          </div>;
        })}
      </dl>
      {error ? <div className="event-submit-error" role="alert">
        <p>{error.message}</p>
        {error.requestId ? <p>リクエストID：{error.requestId}</p> : null}
        <p>内容を変更せず、もう一度作成をお試しください。</p>
      </div> : null}
      <p className="event-submit-status" role="status" aria-live="polite">{pending ? '日程調整を作成しています…' : ''}</p>
      <div className="event-actions">
        <button type="button" className="event-button event-button-secondary" disabled={pending} onClick={onBack}>戻る</button>
        <button type="button" className="event-button event-button-primary" disabled={pending} onClick={onSubmit}>日程調整を作成</button>
      </div>
    </section>
  );
}
