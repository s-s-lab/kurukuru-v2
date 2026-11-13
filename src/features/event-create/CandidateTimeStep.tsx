import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Trash2 } from 'lucide-react';

import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import { DAY_SLOT_INDEXES, formatTimelineHeader } from '../../domain/timeline';
import { CandidateDateCalendar } from './CandidateDateCalendar';
import type { CandidateDayDraft, FieldErrors } from './event-draft';

const SLOTS = DAY_SLOT_INDEXES;

function formatDate(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

type CandidateTimeStepProps = {
  days: CandidateDayDraft[];
  currentDate: string;
  errors: FieldErrors;
  heading?: string;
  description?: string;
  disabled?: boolean;
  onToggleDate: (date: string) => void;
  onRemoveDate: (date: string) => void;
  onApplyRange: (startSlot: number, endSlot: number) => void;
  onClearAllSlots: () => void;
  onPaintSlot: (date: string, slot: number, selected: boolean) => void;
  onToggleSlot: (date: string, slot: number) => void;
  onBack?: () => void;
  onNext?: () => void;
};

type PaintGesture = { pointerId: number; selected: boolean; visited: Set<string> };

export function CandidateTimeStep({ days, currentDate, errors, heading = '候補日時を選択してください',
  description = '参加できる日と時間を、30分単位で選びます。', disabled = false, onToggleDate, onRemoveDate,
  onApplyRange, onClearAllSlots, onPaintSlot, onToggleSlot, onBack, onNext }: CandidateTimeStepProps) {
  const [interactionMode, setInteractionMode] = useState<'paint' | 'move'>('paint');
  const [rangeStart, setRangeStart] = useState(18);
  const [rangeEnd, setRangeEnd] = useState(24);
  const [bulkStatus, setBulkStatus] = useState('');
  const gesture = useRef<PaintGesture | null>(null);

  function paintCell(cell: HTMLElement, active: PaintGesture) {
    const cellDate = cell.dataset.date;
    const slot = Number(cell.dataset.slot);
    const key = `${cellDate}:${slot}`;
    if (!cellDate || active.visited.has(key)) return;
    active.visited.add(key);
    onPaintSlot(cellDate, slot, active.selected);
  }

  function startPaint(event: PointerEvent<HTMLDivElement>) {
    if (disabled || interactionMode !== 'paint' || event.button !== 0) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!cell) return;
    const active = { pointerId: event.pointerId, selected: cell.getAttribute('aria-pressed') !== 'true', visited: new Set<string>() };
    gesture.current = active;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paintCell(cell, active);
  }

  function continuePaint(event: PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    // Pointer capture retargets events to the scroll area; hit-test the actual cell.
    const hit = typeof document.elementFromPoint === 'function'
      ? document.elementFromPoint(event.clientX, event.clientY) : event.target as Element;
    const cell = hit?.closest<HTMLElement>('[data-slot]');
    if (cell && event.currentTarget.contains(cell)) paintCell(cell, active);
  }

  function endPaint(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <section aria-labelledby="candidate-heading" aria-busy={disabled || undefined}>
      <div className="event-step-heading">
        <h2 id="candidate-heading" tabIndex={-1}>{heading}</h2>
        <p>{description}</p>
      </div>
      <CandidateDateCalendar days={days} currentDate={currentDate} disabled={disabled} onToggleDate={onToggleDate} />
      {errors.date ? <p className="event-field-error candidate-calendar-error" id="candidate-date-error">{errors.date}</p> : null}
      <section className="event-range-picker" aria-labelledby="event-range-heading">
        <div>
          <h3 id="event-range-heading">時間帯をまとめて選ぶ</h3>
          <p>指定した時間帯を、選択中のすべての候補日に追加します。</p>
        </div>
        <div className="event-range-controls">
          <label>開始時刻
            <select value={rangeStart} disabled={disabled} onChange={(event) => {
              const nextStart = Number(event.target.value);
              setRangeStart(nextStart);
              if (rangeEnd <= nextStart) setRangeEnd(nextStart + 1);
            }}>
              {SLOTS.map((slot) => <option key={slot} value={slot}>{formatSlotStart(slot)}</option>)}
            </select>
          </label>
          <span aria-hidden="true">〜</span>
          <label>終了時刻
            <select value={rangeEnd} disabled={disabled} onChange={(event) => setRangeEnd(Number(event.target.value))}>
              {Array.from({ length: 60 - rangeStart }, (_, index) => rangeStart + index + 1)
                .map((boundary) => <option key={boundary} value={boundary}>{formatSlotEnd(boundary - 1)}</option>)}
            </select>
          </label>
          <button type="button" className="event-button event-button-primary" disabled={disabled || days.length === 0}
            onClick={() => {
              onApplyRange(rangeStart, rangeEnd);
              setBulkStatus(`${days.length}日分に${formatSlotStart(rangeStart)}〜${formatSlotEnd(rangeEnd - 1)}を追加しました。`);
            }}>全候補日に追加</button>
          <button type="button" className="event-button event-button-secondary" disabled={disabled || days.length === 0}
            onClick={() => {
              onClearAllSlots();
              setBulkStatus('すべての候補時間を解除しました。');
            }}>すべて解除</button>
        </div>
        <p className="event-range-status" role="status" aria-label="時間帯の一括操作結果" aria-live="polite">{bulkStatus}</p>
      </section>
      <div className="event-grid-toolbar">
        <div className="event-grid-modes" role="group" aria-label="時間表の操作方法">
          <button type="button" aria-pressed={interactionMode === 'paint'} onClick={() => setInteractionMode('paint')}>塗る</button>
          <button type="button" aria-pressed={interactionMode === 'move'} onClick={() => setInteractionMode('move')}>移動</button>
        </div>
        <span>✓ 選択中</span>
        <p>クリック・ドラッグで選択。横にスクロールできます。</p>
      </div>
      <div className={`event-time-scroll ${interactionMode === 'paint' ? 'is-painting' : ''}`}
        onPointerDown={startPaint} onPointerMove={continuePaint} onPointerUp={endPaint}
        onPointerCancel={endPaint} onLostPointerCapture={() => { gesture.current = null; }}
        tabIndex={0} role="region" aria-label="時間表の横スクロール" aria-describedby="candidate-grid-help">
        <table className="event-time-table" aria-label="候補日時の選択">
          <thead><tr><th scope="col" className="event-date-column">候補日</th>
            {SLOTS.map((slot) => <th scope="col" key={slot}
              title={formatSlotStart(slot)}>{formatTimelineHeader(slot)}</th>)}
          </tr></thead>
          <tbody>{days.map((day) => {
            const selectedSlots = new Set(day.slotIndexes);
            return <tr key={day.date}>
              <th scope="row" className="event-date-column">
                <span>{formatDate(day.date)}</span>
                <button type="button" className="event-remove-date" aria-label={`${formatDate(day.date)}を削除`}
                  disabled={disabled} onClick={() => onRemoveDate(day.date)}><Trash2 size={16} aria-hidden="true" /></button>
              </th>
              {SLOTS.map((slot) => <td key={slot}>
                <button type="button" className="event-time-cell" data-date={day.date} data-slot={slot}
                  aria-label={`${formatDate(day.date)} ${formatSlotStart(slot)}〜${formatSlotEnd(slot)} 選択`}
                  aria-pressed={selectedSlots.has(slot)} disabled={disabled}
                  onClick={(event) => {
                    // Physical pointers paint on pointerdown; keyboard/AT clicks have detail 0.
                    if (event.detail === 0 || interactionMode === 'move') onToggleSlot(day.date, slot);
                  }}><span aria-hidden="true">{selectedSlots.has(slot) ? '✓' : ''}</span></button>
              </td>)}
            </tr>;
          })}</tbody>
        </table>
      </div>
      {days.length === 0 ? <p className="event-grid-empty">候補日を追加すると、時間を選べます。</p> : null}
      <p className="event-grid-help" id="candidate-grid-help">06:00〜翌06:00の時間表です。スマートフォンで横へ動かすときは「移動」に切り替えてください。</p>
      <p className="event-field-error" role="status" aria-live="polite">{errors.candidateDays || ''}</p>
      {onBack || onNext ? <div className="event-actions">
        {onBack ? <button type="button" className="event-button event-button-secondary" onClick={onBack}>戻る</button> : null}
        {onNext ? <button type="button" className="event-button event-button-primary" onClick={onNext}>次へ</button> : null}
      </div> : null}
    </section>
  );
}
