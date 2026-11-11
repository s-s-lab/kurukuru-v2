import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import type { ResponseDraft } from './response-model';
import { AvailabilityResponseGrid } from './AvailabilityResponseGrid';

type Props = {
  event: PublicEvent;
  draft: ResponseDraft;
  selectedMark: AvailabilityMark;
  onSelectedMarkChange: (mark: AvailabilityMark) => void;
  onDraftChange: (field: 'displayName' | 'comment', value: string) => void;
  onPaint: (slotIds: string[], mark: AvailabilityMark) => void;
  onSubmit: () => void;
  onClose: () => void;
  isSubmitting: boolean;
  isEditing: boolean;
  saveMessage: string;
};

export function ResponseEditorModal(props: Props) {
  const { event, draft, selectedMark, onSelectedMarkChange, onDraftChange, onPaint,
    onSubmit, onClose, isSubmitting, isEditing, saveMessage } = props;
  const closeButton = useRef<HTMLButtonElement>(null);
  const invalidName = draft.displayName.trim().length < 1 || draft.displayName.trim().length > 80;

  useEffect(() => {
    closeButton.current?.focus();
    const escape = (event_: KeyboardEvent) => {
      if (event_.key === 'Escape' && !isSubmitting) onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [isSubmitting, onClose]);

  const title = isEditing ? '回答を編集' : '回答を追加';
  return <div className="response-modal-backdrop" onMouseDown={(event_) => {
    if (event_.target === event_.currentTarget && !isSubmitting) onClose();
  }}>
    <section className="response-modal" role="dialog" aria-modal="true" aria-labelledby="response-modal-title">
      <header className="response-modal-header">
        <div><p>{event.title}</p><h2 id="response-modal-title">{title}</h2></div>
        <button ref={closeButton} type="button" aria-label="閉じる" onClick={onClose} disabled={isSubmitting}>
          <X size={20} aria-hidden="true" />
        </button>
      </header>
      <div className="response-modal-body">
        <div className="response-modal-identity">
          <div className="participant-field">
            <label htmlFor="participant-name">お名前 <span>必須</span></label>
            <input id="participant-name" value={draft.displayName} maxLength={80}
              autoComplete="name" aria-invalid={invalidName}
              onChange={(event_) => onDraftChange('displayName', event_.target.value)} />
          </div>
          <div className="participant-field">
            <label htmlFor="participant-comment">コメント（任意）</label>
            <textarea id="participant-comment" value={draft.comment} maxLength={1000}
              placeholder="例：この時間は調整しやすいです"
              onChange={(event_) => onDraftChange('comment', event_.target.value)} />
            <small>{draft.comment.length}/1000</small>
          </div>
        </div>
        <AvailabilityResponseGrid event={event} availability={draft.availability}
          selectedMark={selectedMark} onSelectedMarkChange={onSelectedMarkChange} onPaint={onPaint} />
      </div>
      <footer className="response-modal-footer">
        <p role="status" aria-live="polite">{saveMessage || (isEditing ? '選択した回答を編集中です' : '')}</p>
        <div>
          <button type="button" className="event-button event-button-secondary" onClick={onClose} disabled={isSubmitting}>キャンセル</button>
          <button type="button" className="event-button event-button-primary" onClick={onSubmit}
            disabled={isSubmitting || invalidName}>
            {isSubmitting ? '保存中…' : isEditing ? '回答を更新' : '回答を保存'}
          </button>
        </div>
      </footer>
    </section>
  </div>;
}
