import type { AdminEvent } from '../../../functions/admin/service';
import { MARKS } from '../../domain/availability';
import { formatSlotStart } from '../../domain/slots';
import {
  buildAdminResponseGrid,
  formatAdminDate,
  formatAdminSlotRange,
  formatAdminTimestamp,
  formatCandidateDateRange,
  formatFinalization,
} from './admin-model';

type Props = { event: AdminEvent };

export function AdminResponseOverview({ event }: Props) {
  const grid = buildAdminResponseGrid(event);

  return <section className="admin-overview" aria-labelledby="admin-overview-heading">
    <div className="admin-section-heading">
      <div>
        <p>回答状況</p>
        <h2 id="admin-overview-heading">候補時間ごとの回答</h2>
      </div>
      <dl className="admin-schedule-meta">
        <div><dt>候補日</dt><dd>{formatCandidateDateRange(event.candidateSlots)}</dd></div>
        <div><dt>開催日時</dt><dd>{formatFinalization(event.finalization)}</dd></div>
      </dl>
    </div>

    {grid.slotIndexes.length > 0 && <div className="admin-grid-scroll" role="region"
      aria-label="回答状況の時間表スクロール領域" tabIndex={0}>
      <table className="admin-time-table" aria-label="回答状況の時間表">
        <thead><tr><th className="admin-date-column" scope="col">候補日</th>
          {grid.slotIndexes.map((slotIndex) => <th scope="col" key={slotIndex}>
            {formatSlotStart(slotIndex)}
          </th>)}
        </tr></thead>
        <tbody>{grid.dates.map((date) => <tr key={date}>
          <th className="admin-date-column" scope="row">{formatAdminDate(date)}</th>
          {grid.slotIndexes.map((slotIndex) => {
            const slotId = grid.slotIds[`${date}:${slotIndex}`];
            if (!slotId) return <td key={slotIndex} className="admin-slot-blocked"
              aria-label={`${formatAdminDate(date)} ${formatAdminSlotRange(slotIndex)} 候補なし`} />;
            const counts = grid.countsBySlotId[slotId];
            const label = MARKS.map((mark) => `${mark.label}${counts[mark.value]}`).join('、');
            return <td key={slotIndex} className="admin-count-cell"
              aria-label={`${formatAdminDate(date)} ${formatAdminSlotRange(slotIndex)} ${label}`}>
              {MARKS.map((mark) => <span key={mark.value} className={`mark-${mark.value}`}>
                <span aria-hidden="true">{mark.symbol}</span>{counts[mark.value]}
              </span>)}
            </td>;
          })}
        </tr>)}</tbody>
      </table>
    </div>}

    <section className="admin-response-list" aria-labelledby="admin-response-list-heading">
      <div className="admin-response-list-heading">
        <h3 id="admin-response-list-heading">回答者 {event.responses.length}名</h3>
        <p>参加者の更新は、ページを再読み込みすると反映されます。</p>
      </div>
      {event.responses.length === 0
        ? <p className="admin-empty-response">まだ回答はありません。参加者用URLを共有して回答を集めましょう。</p>
        : <ul>{event.responses.map((response) => <li key={response.id}>
          <div><strong>{response.displayName}</strong>
            <time dateTime={response.updatedAt}>更新 {formatAdminTimestamp(response.updatedAt)}</time>
          </div>
          {response.comment && <p>{response.comment}</p>}
        </li>)}</ul>}
    </section>
  </section>;
}
