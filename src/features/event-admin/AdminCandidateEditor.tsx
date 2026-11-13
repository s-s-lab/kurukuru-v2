import { useState } from 'react';

import type { AdminEvent } from '../../../functions/admin/service';
import { CandidateTimeStep } from '../event-create/CandidateTimeStep';
import {
  removeCandidateDay,
  toggleCandidateSlot,
  validateCandidateDays,
  type CandidateDayDraft,
} from '../event-create/event-draft';
import { createCandidateDays } from './admin-schedule-model';

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

  function applyRange(startSlot: number, endSlot: number) {
    const slotIndexes = Array.from({ length: endSlot - startSlot }, (_, index) => startSlot + index);
    setDays((current) => current.map((day) => ({
      ...day,
      slotIndexes: [...new Set([...day.slotIndexes, ...slotIndexes])].sort((left, right) => left - right),
    })));
    setError('');
  }

  function clearAllSlots() {
    setDays((current) => current.map((day) => ({ ...day, slotIndexes: [] })));
    setError('');
  }

  function paintSlot(date: string, slot: number, selected: boolean) {
    setDays((current) => {
      const day = current.find((candidate) => candidate.date === date);
      if (!day || new Set(day.slotIndexes).has(slot) === selected) return current;
      return toggleCandidateSlot(current, date, slot);
    });
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

  return <section className="admin-candidate-editor">
    <CandidateTimeStep days={days} currentDate={currentDate} errors={{ candidateDays: error }}
      heading="候補日時を編集"
      description="変更すると既存回答にも反映されます。削除した時間の回答は取り除かれます。"
      disabled={isMutating}
      onToggleDate={toggleDate}
      onRemoveDate={(date) => setDays((current) => removeCandidateDay(current, date))}
      onApplyRange={applyRange}
      onClearAllSlots={clearAllSlots}
      onPaintSlot={paintSlot}
      onToggleSlot={(date, slot) => setDays((current) => toggleCandidateSlot(current, date, slot))} />
    <p className="admin-operation-message" aria-live="polite">{message}</p>
    <button type="button" className="event-button event-button-primary admin-lifecycle-submit"
      disabled={isMutating} onClick={save}>候補日時を保存</button>
  </section>;
}
