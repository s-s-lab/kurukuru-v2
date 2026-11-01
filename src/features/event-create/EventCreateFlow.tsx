import { useEffect, useRef, useState } from 'react';

import { BasicInformationStep } from './BasicInformationStep';
import { CandidateTimeStep } from './CandidateTimeStep';
import { ConfirmationStep } from './ConfirmationStep';
import { EventCreationSuccess } from './EventCreationSuccess';
import { EventStepIndicator } from './EventStepIndicator';
import { createEvent, EventApiError } from './event-api';
import { buildEventUrls, createEmptyEventDraft, removeCandidateDay, toCreateEventRequest, toggleCandidateSlot, validateBasicInformation, validateCandidateDays } from './event-draft';
import type { BrowserLocation, EventDraft, FieldErrors } from './event-draft';

type EventCreateFlowProps = {
  today: string;
  apiBaseUrl: string;
  location: BrowserLocation;
  createEventRequest?: typeof createEvent;
  createIdempotencyKey?: () => string;
  copyText?: (text: string) => Promise<void>;
};

const randomKey = () => crypto.randomUUID();
const copyToClipboard = (text: string) => navigator.clipboard.writeText(text);
const failureMessage = 'イベントを作成できませんでした。時間をおいて再度お試しください。';

export function EventCreateFlow({ today, apiBaseUrl, location, createEventRequest = createEvent,
  createIdempotencyKey = randomKey, copyText = copyToClipboard }: EventCreateFlowProps) {
  const [draft, setDraft] = useState(createEmptyEventDraft);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [pending, setPending] = useState(false);
  const [submissionError, setSubmissionError] = useState<{ message: string; requestId?: string }>();
  const [eventId, setEventId] = useState<string>();
  const idempotencyKey = useRef<string | undefined>(undefined);
  const submitting = useRef(false);
  const flow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    flow.current?.querySelector<HTMLHeadingElement>('h2')?.focus();
  }, [step, eventId]);

  function draftChanged() {
    idempotencyKey.current = undefined;
    setSubmissionError(undefined);
  }

  function changeField<K extends keyof EventDraft>(field: K, value: EventDraft[K]) {
    if (draft[field] === value) return;
    draftChanged();
    setDraft((previous) => ({ ...previous, [field]: value }));
  }

  function next() {
    const nextErrors = step === 1 ? validateBasicInformation(draft) : validateCandidateDays(draft.candidateDays);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) setStep((previous) => previous + 1);
  }

  function back() {
    if (submitting.current) return;
    setErrors({});
    setStep((previous) => previous - 1);
  }

  function addDate(date: string) {
    if (!date || date < today) {
      setErrors({ date: '今日以降の候補日を選択してください。' });
      return;
    }
    // Validate date admission with the shared validator; time selection happens after adding.
    const nextErrors = validateCandidateDays([...draft.candidateDays.map((day) => ({ ...day, slotIndexes: [12] })), { date, slotIndexes: [12] }]);
    if (nextErrors.candidateDays) {
      setErrors({ date: nextErrors.candidateDays });
      return;
    }
    draftChanged();
    setDraft((previous) => ({ ...previous, candidateDays: [...previous.candidateDays, { date, slotIndexes: [] }] }));
    setErrors({});
  }

  function toggleSlot(date: string, slot: number) {
    draftChanged();
    setDraft((previous) => ({ ...previous, candidateDays: toggleCandidateSlot(previous.candidateDays, date, slot) }));
  }

  function paintSlot(date: string, slot: number, selected: boolean) {
    const day = draft.candidateDays.find((candidate) => candidate.date === date);
    if (!day || new Set(day.slotIndexes).has(slot) === selected) return;
    draftChanged();
    setDraft((previous) => {
      const previousDay = previous.candidateDays.find((candidate) => candidate.date === date);
      if (!previousDay || new Set(previousDay.slotIndexes).has(slot) === selected) return previous;
      return { ...previous, candidateDays: toggleCandidateSlot(previous.candidateDays, date, slot) };
    });
  }

  async function submit() {
    if (submitting.current) return;
    submitting.current = true;
    setPending(true);
    setSubmissionError(undefined);
    try {
      idempotencyKey.current ??= createIdempotencyKey();
      const result = await createEventRequest(toCreateEventRequest(draft), { apiBaseUrl, idempotencyKey: idempotencyKey.current });
      setEventId(result.event.id);
      setDraft(createEmptyEventDraft());
    } catch (error) {
      // Only the API client's safe public error contract is reflected. Never echo a secret.
      const apiError = error instanceof EventApiError ? error : undefined;
      setSubmissionError({
        message: apiError && !apiError.message.includes(draft.adminPassword) ? apiError.message : failureMessage,
        requestId: apiError?.requestId && !apiError.requestId.includes(draft.adminPassword) ? apiError.requestId : undefined,
      });
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <div className="event-create-flow" ref={flow}>
      {eventId ? <EventCreationSuccess {...buildEventUrls(eventId, location)} copyText={copyText} /> : <>
        <EventStepIndicator currentStep={step} />
        {step === 1 ? <BasicInformationStep draft={draft} errors={errors} onChange={changeField} onNext={next} /> : null}
        {step === 2 ? <CandidateTimeStep days={draft.candidateDays} currentDate={today} errors={errors}
          onAddDate={addDate} onRemoveDate={(date) => {
            draftChanged();
            setDraft((previous) => ({ ...previous, candidateDays: removeCandidateDay(previous.candidateDays, date) }));
            setErrors({});
          }} onPaintSlot={paintSlot} onToggleSlot={toggleSlot} onBack={back} onNext={next} /> : null}
        {step === 3 ? <ConfirmationStep draft={draft} pending={pending} error={submissionError} onBack={back} onSubmit={() => { void submit(); }} /> : null}
      </>}
    </div>
  );
}
