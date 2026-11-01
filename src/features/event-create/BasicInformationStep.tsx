import type { FormEvent } from 'react';

import type { EventDraft, FieldErrors } from './event-draft';

type BasicInformationStepProps = {
  draft: EventDraft;
  errors: FieldErrors;
  onChange: <K extends keyof EventDraft>(field: K, value: EventDraft[K]) => void;
  onNext: () => void;
};

export function BasicInformationStep({ draft, errors, onChange, onNext }: BasicInformationStepProps) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onNext();
  }

  return (
    <form className="event-basic-form" noValidate onSubmit={submit} aria-labelledby="basic-heading">
      <div className="event-step-heading">
        <h2 id="basic-heading" tabIndex={-1}>基本情報を入力してください</h2>
        <p>日程調整の名前と、主催者の連絡先を設定します。</p>
      </div>
      <div className="event-field">
        <label htmlFor="event-title">イベント名</label>
        <input id="event-title" value={draft.title} required maxLength={100}
          placeholder="例：11月の定例ミーティング" aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? 'event-title-error' : undefined}
          onChange={(event) => onChange('title', event.target.value)} />
        {errors.title ? <p className="event-field-error" id="event-title-error">{errors.title}</p> : null}
      </div>
      <div className="event-field">
        <label htmlFor="event-description">説明（任意）</label>
        <textarea id="event-description" value={draft.description} rows={4} maxLength={2000}
          placeholder="参加する方へのメッセージを入力できます。" aria-invalid={Boolean(errors.description)}
          aria-describedby={errors.description ? 'event-description-error' : undefined}
          onChange={(event) => onChange('description', event.target.value)} />
        {errors.description ? <p className="event-field-error" id="event-description-error">{errors.description}</p> : null}
      </div>
      <div className="event-field">
        <label htmlFor="event-email">主催者メールアドレス</label>
        <input id="event-email" type="email" autoComplete="email" value={draft.organizerEmail} required
          aria-invalid={Boolean(errors.organizerEmail)} aria-describedby={errors.organizerEmail ? 'event-email-error' : undefined}
          onChange={(event) => onChange('organizerEmail', event.target.value)} />
        {errors.organizerEmail ? <p className="event-field-error" id="event-email-error">{errors.organizerEmail}</p> : null}
      </div>
      <div className="event-field">
        <label htmlFor="event-password">管理用パスワード</label>
        <input id="event-password" type="password" autoComplete="new-password" value={draft.adminPassword} required
          minLength={8} maxLength={128} aria-invalid={Boolean(errors.adminPassword)}
          aria-describedby={errors.adminPassword ? 'event-password-error' : 'event-password-help'}
          onChange={(event) => onChange('adminPassword', event.target.value)} />
        {errors.adminPassword ? <p className="event-field-error" id="event-password-error">{errors.adminPassword}</p>
          : <p className="event-field-help" id="event-password-help">8文字以上。主催者用ページで使用します。</p>}
      </div>
      <label className="event-checkbox">
        <input type="checkbox" checked={draft.notifyOnResponse}
          onChange={(event) => onChange('notifyOnResponse', event.target.checked)} />
        <span>回答時にメールで通知</span>
      </label>
      <p className="event-validation-summary" role="status" aria-live="polite">
        {Object.keys(errors).length > 0 ? '入力内容を確認してください。' : ''}
      </p>
      <div className="event-actions event-actions-end">
        <button type="submit" className="event-button event-button-primary">次へ</button>
      </div>
    </form>
  );
}
