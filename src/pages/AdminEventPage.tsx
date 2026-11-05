import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useParams } from 'react-router-dom';

import type { AdminEvent } from '../../functions/admin/service';
import {
  AdminApiError,
  createAdminSession,
  getAdminEvent,
  replaceAdminCandidateSlots,
} from '../features/event-admin/admin-api';
import { AdminCandidateEditor } from '../features/event-admin/AdminCandidateEditor';
import { AdminLoginForm } from '../features/event-admin/AdminLoginForm';
import { createCandidateRequest } from '../features/event-admin/admin-schedule-model';
import {
  adminSessionStorageKey,
  readAdminSession,
  type StoredAdminSession,
  writeAdminSession,
} from '../features/event-admin/admin-session';
import type { CandidateDayDraft } from '../features/event-create/event-draft';

type Props = { apiBaseUrl: string; fetcher?: typeof fetch; today?: string };
type PageState = 'checking-session' | 'login' | 'authenticated';
type AuthenticatedState = { eventId: string; event: AdminEvent; session: StoredAdminSession };

function participantUrl(eventId: string) {
  return `${window.location.origin}${window.location.pathname}#/events/${encodeURIComponent(eventId)}`;
}
export function AdminEventPage(props: Props) {
  const { eventId = '' } = useParams();
  return <AdminEventPageState key={eventId} eventId={eventId} {...props} />;
}
function AdminEventPageState({ apiBaseUrl, fetcher, eventId, today = new Date().toISOString().slice(0, 10) }: Props & { eventId: string }) {
  const [pageState, setPageState] = useState<PageState>('checking-session');
  const [authenticated, setAuthenticated] = useState<AuthenticatedState | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [loginRequestId, setLoginRequestId] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [candidateRevision, setCandidateRevision] = useState(0);
  const [candidateMessage, setCandidateMessage] = useState('');
  const storageKey = adminSessionStorageKey(eventId);

  useEffect(() => {
    let active = true;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem(storageKey); } catch { /* blocked storage is empty */ }
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

    getAdminEvent(eventId, { apiBaseUrl, sessionToken: stored.sessionToken, fetcher })
      .then((event) => {
        if (!active) return;
        setAuthenticated({ eventId, event, session: stored });
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
    setIsLoggingIn(true);
    setLoginError('');
    setLoginRequestId('');
    try {
      const result = await createAdminSession(eventId, password, { apiBaseUrl, fetcher });
      const stored = { sessionToken: result.sessionToken, expiresAt: result.expiresAt };
      try { sessionStorage.setItem(storageKey, writeAdminSession(stored)); } catch { /* no-op */ }
      setAuthenticated({ eventId, event: result.event, session: stored });
      setPageState('authenticated');
    } catch (error) {
      setLoginError(error instanceof AdminApiError
        ? error.message
        : '候補日時管理を開けませんでした。入力内容を確認して再度お試しください。');
      setLoginRequestId(error instanceof AdminApiError ? error.requestId ?? '' : '');
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function saveCandidates(days: CandidateDayDraft[]) {
    if (!authenticated || authenticated.eventId !== eventId || isSaving) return;
    setIsSaving(true);
    setCandidateMessage('');
    try {
      const updated = await replaceAdminCandidateSlots(eventId, createCandidateRequest(days), {
        apiBaseUrl,
        sessionToken: authenticated.session.sessionToken,
        fetcher,
      });
      setAuthenticated((current) => current?.eventId === eventId
        && updated.version >= current.event.version ? { ...current, event: updated } : current);
      setCandidateRevision((current) => current + 1);
      setCandidateMessage('候補日時を保存しました。公開回答ボードにも反映されています。');
    } catch (error) {
      if (error instanceof AdminApiError && expireSession(error)) return;
      setCandidateMessage(error instanceof AdminApiError
        ? error.message
        : '候補日時を保存できませんでした。時間をおいて再度お試しください。');
    } finally {
      setIsSaving(false);
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
  if (!authenticated) {
    return <main className="shell admin-page-state"><p>管理情報を読み込んでいます…</p></main>;
  }

  const event = authenticated.event;
  return <main className="admin-page admin-candidate-only">
    <div className="shell admin-candidate-shell">
      <header className="admin-candidate-header">
        <div>
          <p>候補日時管理</p>
          <h1>{event.title}</h1>
          <span>管理パスワードが必要な操作は、候補日時の追加・変更・削除だけです。</span>
        </div>
        <a className="event-button event-button-secondary" href={participantUrl(eventId)}>
          <ArrowLeft size={17} aria-hidden="true" />公開回答ボードへ戻る
        </a>
      </header>
      <AdminCandidateEditor key={`${event.id}:${candidateRevision}`} event={event}
        isMutating={isSaving} message={candidateMessage} currentDate={today} onSave={saveCandidates} />
    </div>
  </main>;
}
