import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import type {
  AdminEvent,
  AdminEventUpdateRequest,
  AdminFinalizationRequest,
} from '../../functions/admin/service';
import {
  AdminApiError,
  clearAdminFinalization,
  closeAdminEvent,
  createAdminSession,
  deleteAdminEvent,
  getAdminEvent,
  replaceAdminCandidateSlots,
  reopenAdminEvent,
  sendAdminEmailVerification,
  setAdminFinalization,
  updateAdminEvent,
} from '../features/event-admin/admin-api';
import { AdminCandidateEditor } from '../features/event-admin/AdminCandidateEditor';
import { AdminDeleteControl } from '../features/event-admin/AdminDeleteControl';
import { AdminEmailVerification } from '../features/event-admin/AdminEmailVerification';
import { AdminEventHeader } from '../features/event-admin/AdminEventHeader';
import { AdminEventSettings } from '../features/event-admin/AdminEventSettings';
import { AdminEventStatusControl } from '../features/event-admin/AdminEventStatusControl';
import { AdminFinalizationControl } from '../features/event-admin/AdminFinalizationControl';
import { AdminLoginForm } from '../features/event-admin/AdminLoginForm';
import { AdminResponseOverview } from '../features/event-admin/AdminResponseOverview';
import { createCandidateRequest } from '../features/event-admin/admin-schedule-model';
import {
  adminSessionStorageKey,
  readAdminSession,
  type StoredAdminSession,
  writeAdminSession,
} from '../features/event-admin/admin-session';
import type { CandidateDayDraft } from '../features/event-create/event-draft';

type Props = {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
};

type PageState = 'checking-session' | 'login' | 'authenticated' | 'deleted';
type AuthenticatedState = {
  eventId: string;
  event: AdminEvent;
  session: StoredAdminSession;
};

function participantUrl(eventId: string) {
  return `${window.location.origin}${window.location.pathname}#/events/${encodeURIComponent(eventId)}`;
}

export function AdminEventPage(props: Props) {
  const { eventId = '' } = useParams();
  return <AdminEventPageState key={eventId} eventId={eventId} {...props} />;
}

function AdminEventPageState({ apiBaseUrl, fetcher, eventId }: Props & { eventId: string }) {
  const [pageState, setPageState] = useState<PageState>('checking-session');
  const [authenticated, setAuthenticated] = useState<AuthenticatedState | null>(null);
  const [settingsRevision, setSettingsRevision] = useState(0);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginRequestId, setLoginRequestId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [isChangingStatus, setIsChangingStatus] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isSharing, setIsSharing] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [lifecycleAction, setLifecycleAction] = useState<
    null | 'candidates' | 'set-finalization' | 'clear-finalization' | 'delete'
  >(null);
  const [candidateRevision, setCandidateRevision] = useState(0);
  const [candidateMessage, setCandidateMessage] = useState('');
  const [finalizationMessage, setFinalizationMessage] = useState('');
  const [deleteMessage, setDeleteMessage] = useState('');
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState('');
  const storageKey = adminSessionStorageKey(eventId);

  useEffect(() => {
    let active = true;
    const requestedEventId = eventId;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(storageKey);
    } catch {
      // A blocked storage area behaves like an empty same-tab session.
    }
    const stored = readAdminSession(raw);
    if (!stored) {
      if (raw !== null) {
        try { sessionStorage.removeItem(storageKey); } catch { /* no-op */ }
      }
      queueMicrotask(() => {
        if (!active) return;
        setAuthenticated(null);
        setPageState('login');
      });
      return () => { active = false; };
    }

    queueMicrotask(() => {
      if (!active) return;
      setAuthenticated(null);
      setPageState('checking-session');
    });

    getAdminEvent(eventId, { apiBaseUrl, sessionToken: stored.sessionToken, fetcher })
      .then((loaded) => {
        if (!active) return;
        setAuthenticated({ eventId: requestedEventId, event: loaded, session: stored });
        setSettingsRevision(0);
        setPageState('authenticated');
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (error instanceof AdminApiError && error.code === 'ADMIN_ACCESS_DENIED') {
          try { sessionStorage.removeItem(storageKey); } catch { /* no-op */ }
          setLoginError('管理セッションの有効期限が切れました。管理用パスワードを再入力してください。');
          setLoginRequestId(error.requestId ?? '');
        } else {
          setLoginError(error instanceof AdminApiError
            ? error.message
            : '管理情報を読み込めませんでした。時間をおいて再度お試しください。');
        }
        setAuthenticated(null);
        setPageState('login');
      });
    return () => { active = false; };
  }, [apiBaseUrl, eventId, fetcher, storageKey]);

  function expireSession(error: AdminApiError) {
    if (error.code !== 'ADMIN_ACCESS_DENIED') return false;
    try { sessionStorage.removeItem(storageKey); } catch { /* no-op */ }
    setAuthenticated(null);
    setLoginError('管理セッションの有効期限が切れました。管理用パスワードを再入力してください。');
    setLoginRequestId(error.requestId ?? '');
    setPageState('login');
    return true;
  }

  async function login(password: string) {
    if (isLoggingIn) return;
    const requestedEventId = eventId;
    setIsLoggingIn(true);
    setLoginError('');
    setLoginRequestId('');
    try {
      const result = await createAdminSession(eventId, password, { apiBaseUrl, fetcher });
      const stored = { sessionToken: result.sessionToken, expiresAt: result.expiresAt };
      try { sessionStorage.setItem(storageKey, writeAdminSession(stored)); } catch { /* no-op */ }
      setAuthenticated({ eventId: requestedEventId, event: result.event, session: stored });
      setSettingsRevision(0);
      setPageState('authenticated');
    } catch (error) {
      setLoginError(error instanceof AdminApiError
        ? error.message
        : '管理画面を開けませんでした。入力内容を確認して再度お試しください。');
      setLoginRequestId(error instanceof AdminApiError ? error.requestId ?? '' : '');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function save(request: AdminEventUpdateRequest) {
    if (!authenticated || authenticated.eventId !== eventId
      || isSaving || isChangingStatus || lifecycleAction !== null) return;
    const requestedEventId = eventId;
    const sessionToken = authenticated.session.sessionToken;
    setIsSaving(true);
    setSaveMessage('');
    setFieldErrors({});
    try {
      const updated = await updateAdminEvent(eventId, request, {
        apiBaseUrl, sessionToken, fetcher,
      });
      const organizerEmailChanged = updated.organizerEmail !== authenticated.event.organizerEmail;
      setAuthenticated((current) => current?.eventId === requestedEventId
        && updated.version >= current.event.version ? { ...current, event: updated } : current);
      setSettingsRevision((current) => current + 1);
      if (organizerEmailChanged) setVerificationMessage('');
      setSaveMessage(
        organizerEmailChanged && !updated.organizerEmailVerified
          ? '変更を保存しました。新しいメールアドレスへ確認メールを送信してください。'
          : '変更を保存しました。',
      );
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setSaveMessage(error instanceof AdminApiError
        ? error.message
        : '変更を保存できませんでした。時間をおいて再度お試しください。');
      setFieldErrors(error instanceof AdminApiError ? error.fieldErrors ?? {} : {});
    } finally {
      setIsSaving(false);
    }
  }

  async function changeStatus(action: 'close' | 'reopen') {
    if (!authenticated || authenticated.eventId !== eventId
      || isSaving || isChangingStatus || lifecycleAction !== null) return;
    const requestedEventId = eventId;
    const sessionToken = authenticated.session.sessionToken;
    setIsChangingStatus(true);
    setStatusMessage('');
    try {
      const options = { apiBaseUrl, sessionToken, fetcher };
      const updated = action === 'close'
        ? await closeAdminEvent(eventId, options)
        : await reopenAdminEvent(eventId, options);
      setAuthenticated((current) => current?.eventId === requestedEventId
        && updated.version >= current.event.version ? { ...current, event: updated } : current);
      setStatusMessage(action === 'close'
        ? '回答受付を停止しました。'
        : '回答受付を再開しました。');
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setStatusMessage(error instanceof AdminApiError
        ? error.message
        : '受付状態を変更できませんでした。時間をおいて再度お試しください。');
    } finally {
      setIsChangingStatus(false);
    }
  }

  async function share() {
    const event = authenticated?.eventId === eventId ? authenticated.event : null;
    if (!event || isSharing) return;
    setIsSharing(true);
    setShareMessage('');
    const url = participantUrl(eventId);
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, url });
        setShareMessage('参加者用URLを共有しました。');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareMessage('参加者用URLをコピーしました。');
      } else {
        setShareMessage('上の参加者用URLを選択してコピーしてください。');
      }
    } catch {
      setShareMessage('参加者用URLを共有できませんでした。ブラウザのアドレスを確認してください。');
    } finally {
      setIsSharing(false);
    }
  }

  function replaceEvent(updated: AdminEvent, requestedEventId: string) {
    setAuthenticated((current) => current?.eventId === requestedEventId
      && updated.version >= current.event.version ? { ...current, event: updated } : current);
  }

  async function saveCandidates(days: CandidateDayDraft[]) {
    if (!authenticated || authenticated.eventId !== eventId
      || isSaving || isChangingStatus || lifecycleAction !== null) return;
    const requestedEventId = eventId;
    setLifecycleAction('candidates');
    setCandidateMessage('');
    try {
      const updated = await replaceAdminCandidateSlots(eventId, createCandidateRequest(days), {
        apiBaseUrl, sessionToken: authenticated.session.sessionToken, fetcher,
      });
      replaceEvent(updated, requestedEventId);
      setCandidateRevision((current) => current + 1);
      setCandidateMessage('候補日時を保存しました。');
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setCandidateMessage(error instanceof AdminApiError && error.code === 'EVENT_FINALIZED'
        ? '確定日時を含む候補時間は削除できません。先に開催日時の確定を解除してください。'
        : error instanceof AdminApiError ? error.message
          : '候補日時を保存できませんでした。時間をおいて再度お試しください。');
    } finally {
      setLifecycleAction(null);
    }
  }

  async function changeFinalization(action: 'set' | 'clear', request?: AdminFinalizationRequest) {
    if (!authenticated || authenticated.eventId !== eventId
      || isSaving || isChangingStatus || lifecycleAction !== null) return;
    const requestedEventId = eventId;
    setLifecycleAction(action === 'set' ? 'set-finalization' : 'clear-finalization');
    setFinalizationMessage('');
    try {
      const options = { apiBaseUrl, sessionToken: authenticated.session.sessionToken, fetcher };
      const updated = action === 'set' && request
        ? await setAdminFinalization(eventId, request, options)
        : await clearAdminFinalization(eventId, options);
      replaceEvent(updated, requestedEventId);
      setFinalizationMessage(action === 'set'
        ? '開催日時を確定しました。'
        : '開催日時の確定を解除しました。');
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setFinalizationMessage(error instanceof AdminApiError
        ? error.message
        : '開催日時を変更できませんでした。時間をおいて再度お試しください。');
    } finally {
      setLifecycleAction(null);
    }
  }

  async function removeEvent() {
    if (!authenticated || authenticated.eventId !== eventId
      || isSaving || isChangingStatus || lifecycleAction !== null) return;
    setLifecycleAction('delete');
    setDeleteMessage('');
    try {
      await deleteAdminEvent(eventId, {
        apiBaseUrl, sessionToken: authenticated.session.sessionToken, fetcher,
      });
      try { sessionStorage.removeItem(storageKey); } catch { /* no-op */ }
      setAuthenticated(null);
      setPageState('deleted');
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setDeleteMessage(error instanceof AdminApiError
        ? error.message
        : 'イベントを削除できませんでした。時間をおいて再度お試しください。');
    } finally {
      setLifecycleAction(null);
    }
  }

  async function sendEmailVerification() {
    if (!authenticated || authenticated.eventId !== eventId || isSaving || isChangingStatus
      || lifecycleAction !== null || isSendingVerification) return;
    setIsSendingVerification(true);
    setVerificationMessage('');
    try {
      const result = await sendAdminEmailVerification(eventId, {
        apiBaseUrl, sessionToken: authenticated.session.sessionToken, fetcher,
      });
      if (result.status === 'already-verified') {
        setAuthenticated((current) => current?.eventId === eventId
          ? { ...current, event: { ...current.event, organizerEmailVerified: true } }
          : current);
        setVerificationMessage('メールアドレスは確認済みです。');
      } else {
        setVerificationMessage('確認メールを送信しました。24時間以内にリンクを開いてください。');
      }
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setVerificationMessage(error instanceof AdminApiError
        ? error.message
        : '確認メールを送信できませんでした。時間をおいて再度お試しください。');
    } finally {
      setIsSendingVerification(false);
    }
  }

  if (pageState === 'checking-session'
    || (pageState === 'authenticated' && authenticated?.eventId !== eventId)) {
    return <main className="shell admin-page-state"><p>管理セッションを確認しています…</p></main>;
  }
  if (pageState === 'login') {
    return <AdminLoginForm onSubmit={login} isSubmitting={isLoggingIn}
      errorMessage={loginError} requestId={loginRequestId} />;
  }
  if (pageState === 'deleted') {
    return <main className="shell admin-page-state admin-deleted-state">
      <p>削除完了</p><h1>イベントを削除しました</h1>
      <p>参加者用ページと主催者用ページは利用できなくなりました。</p>
      <a className="event-button event-button-primary" href="./">トップへ戻る</a>
    </main>;
  }
  if (!authenticated || authenticated.eventId !== eventId) {
    return <main className="shell admin-page-state"><p>管理情報を読み込んでいます…</p></main>;
  }
  const event = authenticated.event;
  const url = participantUrl(eventId);
  const isMutating = isSaving || isChangingStatus || lifecycleAction !== null
    || isSendingVerification;

  return <main className="admin-page">
    <div className="shell">
      <AdminEventHeader event={event} participantUrl={url}
        onShare={share} isSharing={isSharing}
        shareMessage={shareMessage} />
      <div className="admin-workspace">
        <AdminEventStatusControl status={event.status}
          onClose={() => changeStatus('close')} onReopen={() => changeStatus('reopen')}
          isChanging={isChangingStatus} isDisabled={isMutating} message={statusMessage} />
        <AdminResponseOverview event={event} />
        <AdminEventSettings key={`${event.id}:${settingsRevision}`} event={event} onSave={save}
          isSaving={isSaving} isDisabled={isMutating}
          saveMessage={saveMessage} fieldErrors={fieldErrors} />
        <AdminEmailVerification verified={event.organizerEmailVerified}
          notifyOnResponse={event.notifyOnResponse} isSending={isSendingVerification}
          isDisabled={isMutating} message={verificationMessage}
          onSend={sendEmailVerification} />
      </div>
      <div className="admin-lifecycle-workspace">
        <AdminFinalizationControl event={event} isDisabled={isMutating}
          pendingAction={lifecycleAction === 'set-finalization' ? 'set'
            : lifecycleAction === 'clear-finalization' ? 'clear' : null}
          message={finalizationMessage}
          onSet={(request) => changeFinalization('set', request)}
          onClear={() => changeFinalization('clear')} />
        <AdminCandidateEditor key={`${event.id}:${candidateRevision}`} event={event}
          isMutating={isMutating} message={candidateMessage} onSave={saveCandidates} />
        <AdminDeleteControl eventTitle={event.title} isDisabled={isMutating}
          isDeleting={lifecycleAction === 'delete'}
          message={deleteMessage} onDelete={removeEvent} />
      </div>
    </div>
  </main>;
}
