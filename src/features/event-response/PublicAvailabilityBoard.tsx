import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import { MARKS } from '../../domain/availability';
import { formatSlotStart } from '../../domain/slots';

type Props = { event: PublicEvent };

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const symbolByMark = Object.fromEntries(MARKS.map(({ value, symbol }) => [value, symbol])) as Record<AvailabilityMark, string>;
const labelByMark = Object.fromEntries(MARKS.map(({ value, label }) => [value, label])) as Record<AvailabilityMark, string>;

function formatDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}（${weekdays[parsed.getDay()]}）`;
}

export function PublicAvailabilityBoard({ event }: Props) {
  const slots = [...event.candidateSlots]
    .sort((left, right) => left.date.localeCompare(right.date) || left.slotIndex - right.slotIndex);

  return <section className="public-board" aria-labelledby="public-board-heading">
    <div className="public-board-heading">
      <div>
        <p>PUBLIC BOARD</p>
        <h2 id="public-board-heading">みんなの回答</h2>
      </div>
      <span>{event.responses.length}名が回答</span>
    </div>
    <div className="public-board-scroll" role="region" aria-label="回答ボードの横スクロール" tabIndex={0}>
      <table className="public-board-table" aria-label="みんなの回答">
        <thead><tr>
          <th scope="col" className="public-board-name">回答者</th>
          {slots.map((slot) => <th scope="col" key={slot.id}>
            <span>{formatDate(slot.date)}</span><strong>{formatSlotStart(slot.slotIndex)}</strong>
          </th>)}
        </tr></thead>
        <tbody>
          {event.responses.map((response) => {
            const answers = new Map(response.availability.map((answer) => [answer.candidateSlotId, answer.mark]));
            return <tr key={response.id}>
              <th scope="row" className="public-board-name">{response.displayName}</th>
              {slots.map((slot) => {
                const mark = answers.get(slot.id) ?? 'ng';
                return <td key={slot.id} className={`public-board-mark mark-${mark}`}
                  aria-label={`${response.displayName}、${formatDate(slot.date)} ${formatSlotStart(slot.slotIndex)}、${labelByMark[mark]}`}>
                  {symbolByMark[mark]}
                </td>;
              })}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {event.responses.length === 0
      ? <p className="public-board-empty">まだ回答はありません。最初の回答を追加してください。</p>
      : <div className="public-comments" aria-label="参加者のコメント">
        <h3>コメント</h3>
        <ul>{event.responses.map((response) => <li key={response.id}>
          <strong>{response.displayName}</strong>
          <span>{response.comment || 'コメントはありません'}</span>
        </li>)}</ul>
      </div>}
  </section>;
}
