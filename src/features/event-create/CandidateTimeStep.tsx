import { useRef, useState } from 'react';
import type { FormEvent, PointerEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import type { CandidateDayDraft, FieldErrors } from './event-draft';

const SLOTS = Array.from({ length: 36 }, (_, index) => index + 12);

function formatDate(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

type CandidateTimeStepProps = {
  days: CandidateDayDraft[];
  currentDate: string;
  errors: FieldErrors;
  onAddDate: (date: string) => void;
  onRemoveDate: (date: string) => void;
  onPaintSlot: (date: string, slot: number, selected: boolean) => void;
  onToggleSlot: (date: string, slot: number) => void;
  onBack: () => void;
  onNext: () => void;
};

type PaintGesture = { pointerId: number; selected: boolean; visited: Set<string> };

export function CandidateTimeStep({ days, currentDate, errors, onAddDate, onRemoveDate,
  onPaintSlot, onToggleSlot, onBack, onNext }: CandidateTimeStepProps) {
  const [date, setDate] = useState('');
  const [interactionMode, setInteractionMode] = useState<'paint' | 'move'>('paint');
  const gesture = useRef<PaintGesture | null>(null);

  function addDate(event: FormEvent) {
    event.preventDefault();
    onAddDate(date);
  }

  function paintCell(cell: HTMLElement, active: PaintGesture) {
    const cellDate = cell.dataset.date;
    const slot = Number(cell.dataset.slot);
    const key = `${cellDate}:${slot}`;
    if (!cellDate || active.visited.has(key)) return;
    active.visited.add(key);
    onPaintSlot(cellDate, slot, active.selected);
  }

  function startPaint(event: PointerEvent<HTMLDivElement>) {
    if (interactionMode !== 'paint' || event.button !== 0) return;
    const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-slot]');
    if (!cell) return;
    const active = { pointerId: event.pointerId, selected: cell.getAttribute('aria-pressed') !== 'true', visited: new Set<string>() };
    gesture.current = active;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    paintCell(cell, active);
  }

  function continuePaint(event: PointerEvent<HTMLDivElement>) {
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
    <section aria-labelledby="candidate-heading">
      <div className="event-step-heading">
        <h2 id="candidate-heading" tabIndex={-1}>候補日時を選択してください</h2>
        <p>参加できる日と時間を、30分単位で選びます。</p>
      </div>
      <div className="event-grid-toolbar">
        <div className="event-grid-modes" role="group" aria-label="時間表の操作方法">
          <button type="button" aria-pressed={interactionMode === 'paint'} onClick={() => setInteractionMode('paint')}>塗る</button>
          <button type="button" aria-pressed={interactionMode === 'move'} onClick={() => setInteractionMode('move')}>移動</button>
        </div>
        <span>✓ 選択中</span>
        <p>クリック・ドラッグで選択。横にスクロールできます。</p>
      </div>
      <form className="event-date-form" onSubmit={addDate} noValidate>
        <div className="event-field">
          <label htmlFor="candidate-date">候補日</label>
          <input type="date" id="candidate-date" min={currentDate} value={date}
            aria-invalid={Boolean(errors.date)} aria-describedby={errors.date ? 'candidate-date-error' : undefined}
            onChange={(event) => setDate(event.target.value)} />
        </div>
        <button type="submit" className="event-button event-button-secondary"><Plus size={17} aria-hidden="true" />候補日を追加</button>
      </form>
      {errors.date ? <p className="event-field-error" id="candidate-date-error">{errors.date}</p> : null}
      <div className={`event-time-scroll ${interactionMode === 'paint' ? 'is-painting' : ''}`}
        onPointerDown={startPaint} onPointerMove={continuePaint} onPointerUp={endPaint}
        onPointerCancel={endPaint} onLostPointerCapture={() => { gesture.current = null; }}
        tabIndex={0} role="region" aria-label="時間表の横スクロール" aria-describedby="candidate-grid-help">
        <table className="event-time-table" aria-label="候補日時の選択">
          <thead><tr><th scope="col" className="event-date-column">候補日</th>
            {SLOTS.map((slot) => <th scope="col" key={slot}>{formatSlotStart(slot)}</th>)}
          </tr></thead>
          <tbody>{days.map((day) => {
            const selectedSlots = new Set(day.slotIndexes);
            return <tr key={day.date}>
              <th scope="row" className="event-date-column">
                <span>{formatDate(day.date)}</span>
                <button type="button" className="event-remove-date" aria-label={`${formatDate(day.date)}を削除`}
                  onClick={() => onRemoveDate(day.date)}><Trash2 size={16} aria-hidden="true" /></button>
              </th>
              {SLOTS.map((slot) => <td key={slot}>
                <button type="button" className="event-time-cell" data-date={day.date} data-slot={slot}
                  aria-label={`${formatDate(day.date)} ${formatSlotStart(slot)}〜${formatSlotEnd(slot)} 選択`}
                  aria-pressed={selectedSlots.has(slot)}
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
      <p className="event-grid-help" id="candidate-grid-help">06:00〜24:00の時間表です。スマートフォンで横へ動かすときは「移動」に切り替えてください。</p>
      <p className="event-field-error" role="status" aria-live="polite">{errors.candidateDays || ''}</p>
      <div className="event-actions">
        <button type="button" className="event-button event-button-secondary" onClick={onBack}>戻る</button>
        <button type="button" className="event-button event-button-primary" onClick={onNext}>次へ</button>
      </div>
    </section>
  );
}
