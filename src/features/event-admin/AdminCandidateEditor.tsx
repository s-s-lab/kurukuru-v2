import { useState } from 'react';
import { Trash2 } from 'lucide-react';

import type { AdminEvent } from '../../../functions/admin/service';
import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import { DAY_SLOT_INDEXES, formatTimelineHeader } from '../../domain/timeline';
import {
  removeCandidateDay,
  toggleCandidateSlot,
  validateCandidateDays,
  type CandidateDayDraft,
} from '../event-create/event-draft';
import { CandidateDateCalendar } from '../event-create/CandidateDateCalendar';
import { createCandidateDays } from './admin-schedule-model';

const SLOTS = DAY_SLOT_INDEXES;

function formatDate(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

type Props = {
  event: AdminEvent;
  isMutating: boolean;
  message: string;
  currentDate: string;
  onSave: (days: CandidateDayDraft[]) => void;
};

export function AdminCandidateEditor({ event, isMutating, message, currentDate, onSave }: Props) {
  const [days, setDays] = useState(() => createCandidateDays(event.candidateSlots));
  const [error, setError] = useState('');

  function toggleDate(date: string) {
    setDays((current) => current.some((day) => day.date === date)
      ? removeCandidateDay(current, date)
      : [...current, { date, slotIndexes: [] }].sort((left, right) => left.date.localeCompare(right.date)));
    setError('');
  }

  function save() {
    const validation = validateCandidateDays(days);
    if (validation.candidateDays) {
      setError(validation.candidateDays);
      return;
    }
    setError('');
    onSave(days);
  }

  return <section className="admin-candidate-editor" aria-labelledby="admin-candidates-heading">
    <div className="admin-lifecycle-heading">
      <div><p>日程管理</p><h2 id="admin-candidates-heading">候補日時を編集</h2></div>
      <p>変更すると既存回答にも反映されます。削除した時間の回答は取り除かれます。</p>
    </div>
    <CandidateDateCalendar days={days} currentDate={currentDate} onToggleDate={toggleDate} />
    <div className="admin-candidate-scroll" role="region" tabIndex={0} aria-label="候補日時の編集表スクロール領域">
      <table className="admin-candidate-table" aria-label="候補日時の編集">
        <thead><tr><th scope="col" className="admin-date-column">候補日</th>
          {SLOTS.map((slot) => <th scope="col" key={slot}
            title={formatSlotStart(slot)}>{formatTimelineHeader(slot)}</th>)}
        </tr></thead>
        <tbody>{days.map((day) => {
          const selected = new Set(day.slotIndexes);
          return <tr key={day.date}>
            <th scope="row" className="admin-date-column"><span>{formatDate(day.date)}</span>
              <button type="button" className="event-remove-date" aria-label={`${formatDate(day.date)}を削除`}
                disabled={isMutating} onClick={() => setDays((current) => removeCandidateDay(current, day.date))}>
                <Trash2 size={15} aria-hidden="true" />
              </button>
            </th>
            {SLOTS.map((slot) => <td key={slot}><button type="button" className="event-time-cell"
              aria-label={`${formatDate(day.date)} ${formatSlotStart(slot)}〜${formatSlotEnd(slot)} 選択`}
              aria-pressed={selected.has(slot)} disabled={isMutating}
              onClick={() => setDays((current) => toggleCandidateSlot(current, day.date, slot))}>
              <span aria-hidden="true">{selected.has(slot) ? '✓' : ''}</span>
            </button></td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
    {days.length === 0 ? <p className="event-grid-empty">候補日を1日以上追加してください。</p> : null}
    <p className="event-grid-help">06:00〜翌06:00を30分単位で選択できます。表は横へスクロールできます。</p>
    <p className="event-field-error" role="alert">{error}</p>
    <p className="admin-operation-message" aria-live="polite">{message}</p>
    <button type="button" className="event-button event-button-primary admin-lifecycle-submit"
      disabled={isMutating} onClick={save}>候補日時を保存</button>
  </section>;
}
