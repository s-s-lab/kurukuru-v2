import { useCallback, useRef, useState } from 'react';
import { CalendarDays, Share2 } from 'lucide-react';

import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import type { ResponseDraft } from './response-model';
import { PublicAvailabilityBoard } from './PublicAvailabilityBoard';
import { ResponseEditorModal } from './ResponseEditorModal';

type Props = {
  event: PublicEvent;
  draft: ResponseDraft;
  selectedMark: AvailabilityMark;
  onSelectedMarkChange: (mark: AvailabilityMark) => void;
  onDraftChange: (field: 'displayName' | 'comment', value: string) => void;
  onPaint: (slotIds: string[], mark: AvailabilityMark) => void;
  onSubmit: () => void;
  onShare: () => void;
  isSubmitting: boolean;
  ownsResponse: boolean;
  saveMessage: string;
};

function dateRange(event: PublicEvent) {
  const dates = [...new Set(event.candidateSlots.map(({ date }) => date))].sort();
  const format = (date: string) => {
    const [, month, day] = date.split('-');
    return `${Number(month)}月${Number(day)}日`;
  };
  if (!dates.length) return '候補日時なし';
  return dates.length === 1 ? format(dates[0]) : `${format(dates[0])}〜${format(dates.at(-1)!)}`;
}

export function ParticipantResponseForm(props: Props) {
  const { event, onShare, ownsResponse, saveMessage } = props;
  const [editorOpen, setEditorOpen] = useState(false);
  const openButton = useRef<HTMLButtonElement>(null);
  const closed = event.status === 'closed';
  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    requestAnimationFrame(() => openButton.current?.focus());
  }, []);

  return <main className="participant-page">
    <section className="participant-summary shell participant-summary-compact">
      <div>
        <div className="participant-title-row">
          <strong className={closed ? 'is-closed' : ''}>{closed ? '回答受付終了' : '回答受付中'}</strong>
          <span><CalendarDays size={16} aria-hidden="true" />{dateRange(event)}</span>
        </div>
        <h1>{event.title}</h1>
        {event.description ? <p>{event.description}</p> : null}
      </div>
      <div className="participant-actions">
        <button type="button" className="event-button event-button-secondary" onClick={onShare}>
          <Share2 size={17} aria-hidden="true" />共有
        </button>
        <button ref={openButton} type="button" className="event-button event-button-primary"
          disabled={closed} onClick={() => setEditorOpen(true)}>
          {ownsResponse ? '自分の回答を編集' : '回答を追加'}
        </button>
      </div>
    </section>
    {event.finalization ? <section className="participant-finalization-inline shell">
      <strong>確定日時</strong><span>{event.finalization.date}</span>
    </section> : null}
    <div className="shell participant-board-workspace">
      <PublicAvailabilityBoard event={event} />
      <p className="participant-save-message" role="status" aria-live="polite">
        {closed ? '回答受付は終了しています' : saveMessage}
      </p>
    </div>
    {editorOpen ? <ResponseEditorModal {...props} onClose={closeEditor} /> : null}
  </main>;
}
