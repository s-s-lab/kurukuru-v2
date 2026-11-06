import { type FormEvent, useState } from 'react';
import { z } from 'zod';

import type { AdminEvent, AdminEventUpdateRequest } from '../../../functions/admin/service';

type Props = {
  event: AdminEvent;
  onSave: (request: AdminEventUpdateRequest) => void | Promise<void>;
  isSaving: boolean;
  isDisabled?: boolean;
  saveMessage: string;
  fieldErrors?: Record<string, string[]>;
};

export function AdminEventSettings({ event, onSave, isSaving, isDisabled = false,
  saveMessage, fieldErrors = {} }: Props) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [duration, setDuration] = useState(event.duration);
  const [organizerEmail, setOrganizerEmail] = useState(event.organizerEmail);
  const [notifyOnResponse, setNotifyOnResponse] = useState(event.notifyOnResponse);
  const [localTitleError, setLocalTitleError] = useState('');
  const [localEmailError, setLocalEmailError] = useState('');

  function submit(event_: FormEvent) {
    event_.preventDefault();
    const normalizedTitle = title.trim();
    const normalizedDescription = description.trim();
    const normalizedDuration = duration.trim();
    const normalizedEmail = organizerEmail.trim().toLowerCase();
    if (!normalizedTitle) {
      setLocalTitleError('イベント名を入力してください。');
      return;
    }
    if (normalizedTitle.length > 120) {
      setLocalTitleError('イベント名は120文字以内で入力してください。');
      return;
    }
    if (normalizedEmail.length > 254 || !z.email().safeParse(normalizedEmail).success) {
      setLocalEmailError('有効なメールアドレスを入力してください。');
      return;
    }
    setLocalTitleError('');
    setLocalEmailError('');
    void onSave({
      title: normalizedTitle,
      description: normalizedDescription,
      duration: normalizedDuration,
      organizerEmail: normalizedEmail,
      notifyOnResponse,
    });
  }

  const titleError = localTitleError || fieldErrors.title?.[0] || '';
  const descriptionError = fieldErrors.description?.[0] || '';
  const durationError = fieldErrors.duration?.[0] || '';
  const organizerEmailError = localEmailError || fieldErrors.organizerEmail?.[0] || '';
  return <aside className="admin-settings" aria-labelledby="admin-settings-heading">
    <div className="admin-settings-heading">
      <p>イベント設定</p>
      <h2 id="admin-settings-heading">基本情報</h2>
    </div>
    <form onSubmit={submit} noValidate>
      <div className="event-field">
        <label htmlFor="admin-event-title">イベント名</label>
        <input id="admin-event-title" value={title} maxLength={120}
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? 'admin-title-error' : undefined}
          onChange={(event_) => { setTitle(event_.target.value); setLocalTitleError(''); }} />
        {titleError && <p className="event-field-error" id="admin-title-error">{titleError}</p>}
      </div>
      <div className="event-field">
        <label htmlFor="admin-organizer-email">主催者メールアドレス</label>
        <input id="admin-organizer-email" type="email" autoComplete="email"
          value={organizerEmail} maxLength={254}
          aria-invalid={Boolean(organizerEmailError)}
          aria-describedby={organizerEmailError ? 'admin-organizer-email-error' : 'admin-organizer-email-note'}
          onChange={(event_) => {
            setOrganizerEmail(event_.target.value);
            setLocalEmailError('');
          }} />
        {organizerEmailError
          ? <p className="event-field-error" id="admin-organizer-email-error">{organizerEmailError}</p>
          : <p className="event-field-help" id="admin-organizer-email-note">
            変更するとメール確認が解除され、新しいアドレスでの再確認が必要です。
          </p>}
      </div>
      <div className="event-field">
        <label htmlFor="admin-event-description">説明</label>
        <textarea id="admin-event-description" value={description} maxLength={2000} rows={5}
          aria-invalid={Boolean(descriptionError)}
          aria-describedby={descriptionError ? 'admin-description-error' : undefined}
          onChange={(event_) => setDescription(event_.target.value)} />
        {descriptionError && <p className="event-field-error" id="admin-description-error">
          {descriptionError}
        </p>}
      </div>
      <div className="event-field">
        <label htmlFor="admin-event-duration">所要時間</label>
        <input id="admin-event-duration" value={duration} maxLength={100}
          placeholder="例：1時間程度" aria-invalid={Boolean(durationError)}
          aria-describedby={durationError ? 'admin-duration-error' : undefined}
          onChange={(event_) => setDuration(event_.target.value)} />
        {durationError && <p className="event-field-error" id="admin-duration-error">{durationError}</p>}
      </div>
      <label className="event-checkbox admin-notification-setting">
        <input type="checkbox" checked={notifyOnResponse}
          onChange={(event_) => setNotifyOnResponse(event_.target.checked)} />
        回答が届いたらメールで通知する
      </label>
      <p className="admin-operation-message" aria-live="polite">{saveMessage}</p>
      <button className="event-button event-button-primary admin-save-button" type="submit"
        disabled={isDisabled || isSaving}>
        {isSaving ? '保存しています…' : '変更を保存'}
      </button>
    </form>

  </aside>;
}
