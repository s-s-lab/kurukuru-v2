import { useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Hand, Pencil } from 'lucide-react';

import { measurePointerPath, paintPointerPath, type PointerPathGeometry, type PointerPoint } from '../../lib/paint-pointer-path';
import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import { MARKS, type AvailabilityMap } from '../../domain/availability';
import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import { DAY_SLOT_INDEXES, formatTimelineHeader, uniqueCandidateDates } from '../../domain/timeline';

type Props = {
  event: PublicEvent;
  availability: AvailabilityMap;
  selectedMark: AvailabilityMark;
  onSelectedMarkChange: (mark: AvailabilityMark) => void;
  onPaint: (slotIds: string[], mark: AvailabilityMark) => void;
};

type Gesture = { pointerId: number; visited: Set<string>; previous: PointerPoint; geometry: PointerPathGeometry };
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(date: string) {
  const value = new Date(`${date}T00:00:00`);
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日（${weekdays[value.getDay()]}）`;
}

function tableLabel(date: string) {
  const [year, month, day] = date.split('-');
  return `${year}年${Number(month)}月${Number(day)}日の回答時間表`;
}

export function AvailabilityResponseGrid({ event, availability, selectedMark,
  onSelectedMarkChange, onPaint }: Props) {
  const [mode, setMode] = useState<'paint' | 'move'>('paint');
  const gesture = useRef<Gesture | null>(null);
  const dates = uniqueCandidateDates(event.candidateSlots);
  const slotIds = new Map(event.candidateSlots.map((slot) => [`${slot.date}:${slot.slotIndex}`, slot.id]));

  function paintCell(cell: HTMLElement, active: Gesture) {
    const slotId = cell.dataset.slotId;
    if (!slotId || active.visited.has(slotId)) return;
    active.visited.add(slotId);
    onPaint([slotId], selectedMark);
  }

  function startPaint(event_: PointerEvent<HTMLDivElement>) {
    if (mode !== 'paint' || event_.button !== 0) return;
    const cell = (event_.target as HTMLElement).closest<HTMLElement>('[data-slot-id]');
    if (!cell) return;
    const active = { pointerId: event_.pointerId, visited: new Set<string>(),
      previous: { clientX: event_.clientX, clientY: event_.clientY },
      geometry: measurePointerPath(event_.currentTarget, '[data-slot-id]') };
    gesture.current = active;
    event_.currentTarget.setPointerCapture?.(event_.pointerId);
    paintCell(cell, active);
  }

  function continuePaint(event_: PointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event_.pointerId) return;
    const next = { clientX: event_.clientX, clientY: event_.clientY };
    paintPointerPath(event_.currentTarget, '[data-slot-id]', active.geometry, active.previous, next,
      (cell) => paintCell(cell, active), event_.target);
    active.previous = next;
  }

  function endPaint(event_: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId !== event_.pointerId) return;
    if (event_.type === 'pointerup') continuePaint(event_);
    gesture.current = null;
    if (event_.currentTarget.hasPointerCapture?.(event_.pointerId)) event_.currentTarget.releasePointerCapture(event_.pointerId);
  }

  return <section className="response-grid-section" aria-labelledby="response-grid-heading">
    <div className="response-grid-heading">
      <h2 id="response-grid-heading">回答を選んで、時間帯を塗ってください</h2>
      <p>候補時間は初期状態で「不可」です。参加できる時間を塗り替えてください。</p>
    </div>
    <div className="response-grid-controls">
      <div className="response-mark-picker" role="group" aria-label="回答の種類">
        {MARKS.map((mark) => <button type="button" key={mark.value}
          className={`response-mark response-mark-${mark.value}`}
          aria-label={mark.label} aria-pressed={selectedMark === mark.value}
          onClick={() => onSelectedMarkChange(mark.value)}>
          <span aria-hidden="true">{mark.symbol}</span><strong>{mark.label}</strong>
        </button>)}
      </div>
      <div className="response-mode-picker" role="group" aria-label="時間表の操作モード">
        <button type="button" aria-pressed={mode === 'paint'} onClick={() => setMode('paint')}>
          <Pencil size={18} aria-hidden="true" />塗る（ドラッグで選択）
        </button>
        <button type="button" aria-pressed={mode === 'move'} onClick={() => setMode('move')}>
          <Hand size={18} aria-hidden="true" />移動（スクロール）
        </button>
      </div>
    </div>
    <div className={`response-grid-scroll ${mode === 'paint' ? 'is-painting' : ''}`}
      role="region" aria-label="回答時間表" tabIndex={0}
      onPointerDown={startPaint} onPointerMove={continuePaint} onPointerUp={endPaint}
      onPointerCancel={endPaint} onLostPointerCapture={() => { gesture.current = null; }}>
      <div className="timeline-date-groups">
        {dates.map((date) => <div className="timeline-date-group" key={date}>
          <div className="timeline-scroll">
            <table className="response-time-table timeline-table" aria-label={tableLabel(date)}>
              <thead><tr><th className="response-date-column timeline-sticky-column" scope="col">{formatDate(date)}</th>
                {DAY_SLOT_INDEXES.map((slot) => <th scope="col" key={slot}>{formatTimelineHeader(slot)}</th>)}
              </tr></thead>
              <tbody><tr><th className="response-date-column timeline-sticky-column" scope="row">あなた</th>
                {DAY_SLOT_INDEXES.map((slot) => {
                  const slotId = slotIds.get(`${date}:${slot}`);
                  if (!slotId) return <td key={slot} className="response-slot-blocked" aria-hidden="true" />;
                  const mark = MARKS.find(({ value }) => value === availability[slotId]) ?? MARKS[3];
                  return <td key={slot}><button type="button" data-slot-id={slotId}
                    className={`response-slot response-slot-${mark.value}`}
                    aria-label={`${formatDate(date)} ${formatSlotStart(slot)}〜${formatSlotEnd(slot)} ${mark.label}`}
                    onClick={(clickEvent) => {
                      if (clickEvent.detail === 0 || mode === 'move') onPaint([slotId], selectedMark);
                    }}><span aria-hidden="true">{mark.symbol}</span></button></td>;
                })}
              </tr></tbody>
            </table>
          </div>
        </div>)}
      </div>
    </div>
  </section>;
}
