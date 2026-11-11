import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import { MARKS } from '../../domain/availability';
import { formatSlotStart } from '../../domain/slots';
import { DAY_SLOT_INDEXES, formatTimelineHeader, uniqueCandidateDates } from '../../domain/timeline';

type Props = { event: PublicEvent; onEditResponse: (responseId: string) => void };

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const symbolByMark = Object.fromEntries(MARKS.map(({ value, symbol }) => [value, symbol])) as Record<AvailabilityMark, string>;
const labelByMark = Object.fromEntries(MARKS.map(({ value, label }) => [value, label])) as Record<AvailabilityMark, string>;

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日（${weekdays[parsed.getDay()]}）`;
}

function tableLabel(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日のみんなの回答`;
}

export function PublicAvailabilityBoard({ event, onEditResponse }: Props) {
  const dates = uniqueCandidateDates(event.candidateSlots);
  const slotsByDateAndIndex = new Map(event.candidateSlots.map((slot) => [`${slot.date}:${slot.slotIndex}`, slot]));

  return <section className="public-board" aria-labelledby="public-board-heading">
    <div className="public-board-heading">
      <div><p>PUBLIC BOARD</p><h2 id="public-board-heading">みんなの回答</h2></div>
      <span>{event.responses.length}名が回答</span>
    </div>
    <p className="public-board-guide">候補時間ごとに、参加者全員の回答を一覧できます。</p>
    <div className="timeline-date-groups">
      {dates.map((date) => <div className="timeline-date-group" key={date}>
        <div className="timeline-scroll" role="region" aria-label={`${formatDate(date)}の回答ボード横スクロール`} tabIndex={0}>
          <table className="public-board-table timeline-table" aria-label={tableLabel(date)}>
            <thead><tr>
              <th scope="col" className="public-board-name timeline-sticky-column">{formatDate(date)}</th>
              {DAY_SLOT_INDEXES.map((slotIndex) => <th scope="col" key={slotIndex}
                title={formatSlotStart(slotIndex)}>{formatTimelineHeader(slotIndex)}</th>)}
            </tr></thead>
            <tbody>{event.responses.map((response) => {
              const answers = new Map(response.availability.map((answer) => [answer.candidateSlotId, answer.mark]));
              return <tr key={response.id}>
                <th scope="row" className="public-board-name timeline-sticky-column">
                  <button type="button" className="public-board-edit-name"
                    aria-label={`${response.displayName}の回答を編集`}
                    disabled={event.status === 'closed'}
                    onClick={() => onEditResponse(response.id)}>{response.displayName}</button>
                </th>
                {DAY_SLOT_INDEXES.map((slotIndex) => {
                  const slot = slotsByDateAndIndex.get(`${date}:${slotIndex}`);
                  if (!slot) return <td key={slotIndex} className="public-board-slot-blocked" aria-hidden="true" />;
                  const mark = answers.get(slot.id) ?? 'ng';
                  return <td key={slotIndex} className={`public-board-mark mark-${mark}`}
                    aria-label={`${response.displayName}、${formatDate(date)} ${formatSlotStart(slotIndex)}、${labelByMark[mark]}`}>
                    {symbolByMark[mark]}
                  </td>;
                })}
              </tr>;
            })}</tbody>
          </table>
        </div>
      </div>)}
    </div>
    {event.responses.length === 0
      ? <p className="public-board-empty">まだ回答はありません。最初の回答を追加してください。</p>
      : <div className="public-comments" aria-label="参加者のコメント">
        <h3>コメント</h3>
        <ul>{event.responses.map((response) => <li key={response.id}>
          <strong>{response.displayName}</strong><span>{response.comment || 'コメントはありません'}</span>
        </li>)}</ul>
      </div>}
  </section>;
}
