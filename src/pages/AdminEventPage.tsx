import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { AdminEvent, AdminEventUpdateRequest } from '../../functions/admin/service';
import {
  AdminApiError,
  closeAdminEvent,
  createAdminSession,
  getAdminEvent,
  reopenAdminEvent,
  updateAdminEvent,
} from '../features/event-admin/admin-api';
import { AdminEventHeader } from '../features/event-admin/AdminEventHeader';
import { AdminEventSettings } from '../features/event-admin/AdminEventSettings';
import { AdminEventStatusControl } from '../features/event-admin/AdminEventStatusControl';
import { AdminLoginForm } from '../features/event-admin/AdminLoginForm';
import { AdminResponseOverview } from '../features/event-admin/AdminResponseOverview';
import {
  adminSessionStorageKey,
  readAdminSession,
  type StoredAdminSession,
  writeAdminSession,
} from '../features/event-admin/admin-session';

type Props = {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
};

type PageState = 'checking-session' | 'login' | 'authenticated';
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
    if (!authenticated || authenticated.eventId !== eventId || isSaving || isChangingStatus) return;
    const requestedEventId = eventId;
    const sessionToken = authenticated.session.sessionToken;
    setIsSaving(true);
    setSaveMessage('');
    setFieldErrors({});
    try {
      const updated = await updateAdminEvent(eventId, request, {
        apiBaseUrl, sessionToken, fetcher,
      });
      setAuthenticated((current) => current?.eventId === requestedEventId
        && updated.version >= current.event.version ? { ...current, event: updated } : current);
      setSettingsRevision((current) => current + 1);
      setSaveMessage('変更を保存しました。');
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
    if (!authenticated || authenticated.eventId !== eventId || isSaving || isChangingStatus) return;
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

  if (pageState === 'checking-session'
    || (pageState === 'authenticated' && authenticated?.eventId !== eventId)) {
    return <main className="shell admin-page-state"><p>管理セッションを確認しています…</p></main>;
  }
  if (pageState === 'login') {
    return <AdminLoginForm onSubmit={login} isSubmitting={isLoggingIn}
      errorMessage={loginError} requestId={loginRequestId} />;
  }
  if (!authenticated || authenticated.eventId !== eventId) {
    return <main className="shell admin-page-state"><p>管理情報を読み込んでいます…</p></main>;
  }
  const event = authenticated.event;
  const url = participantUrl(eventId);
  const isMutating = isSaving || isChangingStatus;

  return <main className="admin-page">
    <div className="shell">
      <AdminEventHeader event={event} participantUrl={url}
        onShare={share} isSharing={isSharing}
        shareMessage={shareMessage} />
      <div className="admin-workspace">
        <AdminEventStatusControl status={event.status}
          onClose={() => changeStatus('close')} onReopen={() => changeStatus('reopen')}
          isChanging={isMutating} message={statusMessage} />
        <AdminResponseOverview event={event} />
        <AdminEventSettings key={`${event.id}:${settingsRevision}`} event={event} onSave={save}
          isSaving={isMutating} saveMessage={saveMessage} fieldErrors={fieldErrors} />
      </div>
    </div>
  </main>;
}
