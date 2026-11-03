import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';

import type { AdminEvent, AdminFinalizationRequest } from '../../../functions/admin/service';
import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import { createCandidateDays, validateFinalization } from './admin-schedule-model';

type Props = {
  event: AdminEvent;
  isDisabled: boolean;
  pendingAction: null | 'set' | 'clear';
  message: string;
  onSet: (request: AdminFinalizationRequest) => void;
  onClear: () => void;
};

export function AdminFinalizationControl({ event, isDisabled, pendingAction,
  message, onSet, onClear }: Props) {
  const days = useMemo(() => createCandidateDays(event.candidateSlots), [event.candidateSlots]);
  const [date, setDate] = useState(event.finalization?.date ?? '');
  const [startSlot, setStartSlot] = useState(event.finalization?.startSlot.toString() ?? '');
  const [endSlot, setEndSlot] = useState(event.finalization?.endSlot.toString() ?? '');
  const [error, setError] = useState('');
  const slots = days.find((day) => day.date === date)?.slotIndexes ?? [];

  function submit(submitEvent: FormEvent) {
    submitEvent.preventDefault();
    const request = { date, startSlot: Number(startSlot), endSlot: Number(endSlot) };
    const validation = date && startSlot && endSlot
      ? validateFinalization(days, request)
      : '開催日・開始時刻・終了時刻を選択してください。';
    if (validation) {
      setError(validation);
      return;
    }
    setError('');
    onSet(request);
  }

  return <section className="admin-finalization" aria-labelledby="admin-finalization-heading">
    <div className="admin-lifecycle-heading">
      <div><p>開催日時</p><h2 id="admin-finalization-heading">日時を確定</h2></div>
      <p>候補時間から連続した範囲を選択します。回答受付の停止とは別の操作です。</p>
    </div>
    {event.finalization ? <div className="admin-finalization-current">
      <p><strong>確定済み</strong> {event.finalization.date}{' '}
        {formatSlotStart(event.finalization.startSlot)}〜{formatSlotEnd(event.finalization.endSlot - 1)}</p>
      <button type="button" className="event-button event-button-secondary" disabled={isDisabled}
        onClick={onClear}>{pendingAction === 'clear' ? '解除しています…' : '開催日時の確定を解除'}</button>
    </div> : <form className="admin-finalization-form" onSubmit={submit}>
      <div className="event-field"><label htmlFor="admin-finalization-date">開催日</label>
        <select id="admin-finalization-date" value={date} aria-invalid={Boolean(error)}
          aria-describedby={error ? 'admin-finalization-error' : undefined}
          onChange={(changeEvent) => {
          setDate(changeEvent.target.value); setStartSlot(''); setEndSlot(''); setError('');
        }}>
          <option value="">選択してください</option>
          {days.map((day) => <option key={day.date} value={day.date}>{day.date}</option>)}
        </select>
      </div>
      <div className="event-field"><label htmlFor="admin-finalization-start">開始時刻</label>
        <select id="admin-finalization-start" value={startSlot}
          aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-finalization-error' : undefined}
          onChange={(changeEvent) => { setStartSlot(changeEvent.target.value); setError(''); }} disabled={!date}>
          <option value="">選択してください</option>
          {slots.map((slot) => <option key={slot} value={slot}>{formatSlotStart(slot)}</option>)}
        </select>
      </div>
      <div className="event-field"><label htmlFor="admin-finalization-end">終了時刻</label>
        <select id="admin-finalization-end" value={endSlot}
          aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-finalization-error' : undefined}
          onChange={(changeEvent) => { setEndSlot(changeEvent.target.value); setError(''); }} disabled={!date}>
          <option value="">選択してください</option>
          {slots.map((slot) => <option key={slot + 1} value={slot + 1}>{formatSlotEnd(slot)}</option>)}
        </select>
      </div>
      <button type="submit" className="event-button event-button-primary" disabled={isDisabled}>
        {pendingAction === 'set' ? '確定しています…' : '開催日時を確定'}
      </button>
    </form>}
    <p className="event-field-error" id="admin-finalization-error" role="alert">{error}</p>
    <p className="admin-operation-message" aria-live="polite">{message}</p>
  </section>;
}
