import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminEvent } from '../../functions/admin/service';
import {
  adminSessionStorageKey,
  writeAdminSession,
} from '../features/event-admin/admin-session';
import { AdminEventPage } from './AdminEventPage';

const eventId = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const token = 'opaque-admin-session-token';
const expiresAt = '2099-11-02T12:00:00.000Z';
const adminEvent: AdminEvent = {
  id: eventId, title: '11月のプロジェクト定例', description: '説明',
  organizerEmail: 'owner@example.com', organizerEmailVerified: true,
  notifyOnResponse: true, status: 'open', finalization: null, version: 1,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }], responses: [],
};

function EventSwitch({ target }: { target: string }) {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(target)}>別のイベントへ</button>;
}

function renderPage(fetcher: typeof fetch) {
  return render(<MemoryRouter initialEntries={[`/events/${eventId}/admin`]}>
    <Routes><Route path="/events/:eventId/admin" element={
      <AdminEventPage apiBaseUrl="https://api.example.test/api/v1" fetcher={fetcher} />
    } /></Routes>
  </MemoryRouter>);
}

function storeSession(value = { sessionToken: token, expiresAt }) {
  sessionStorage.setItem(adminSessionStorageKey(eventId), writeAdminSession(value));
}

describe('organizer admin page', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    window.history.replaceState({}, '', '/');
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'share');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('shows login without disclosing the event before authentication', async () => {
    renderPage(vi.fn<typeof fetch>());
    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(screen.queryByText(adminEvent.title)).not.toBeInTheDocument();
  });

  it('logs in, stores only the same-tab session, and removes the password from the DOM', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      sessionToken: token, expiresAt, event: adminEvent,
    }, { status: 201 }));
    const user = userEvent.setup();
    renderPage(fetcher);
    const password = await screen.findByLabelText('管理用パスワード');
    await user.type(password, 'private-password-sentinel');
    await user.click(screen.getByRole('button', { name: '管理画面を開く' }));

    expect(await screen.findByRole('heading', { name: adminEvent.title })).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/events/${eventId}/admin/sessions`,
      expect.objectContaining({ body: JSON.stringify({ password: 'private-password-sentinel' }) }),
    );
    expect(JSON.parse(sessionStorage.getItem(adminSessionStorageKey(eventId)) ?? '')).toEqual({
      sessionToken: token, expiresAt,
    });
    expect(localStorage.length).toBe(0);
    expect(document.body.textContent).not.toContain('private-password-sentinel');
    expect(document.body.textContent).not.toContain(token);
  });

  it('restores a valid session and removes it when access is denied', async () => {
    storeSession();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      code: 'ADMIN_ACCESS_DENIED', message: '管理用の認証情報を確認してください。',
      requestId: 'request-denied',
    }, { status: 404 }));
    renderPage(fetcher);

    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('管理セッションの有効期限が切れました。');
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/events/${eventId}/admin`,
      expect.objectContaining({ headers: expect.objectContaining({ authorization: `Bearer ${token}` }) }),
    );
  });

  it('removes an expired stored session without making an authenticated request', async () => {
    storeSession({ sessionToken: token, expiresAt: '2000-01-01T00:00:00.000Z' });
    const fetcher = vi.fn<typeof fetch>();
    renderPage(fetcher);
    expect(await screen.findByLabelText('管理用パスワード')).toBeInTheDocument();
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('removes even an empty malformed stored session', async () => {
    sessionStorage.setItem(adminSessionStorageKey(eventId), '');
    renderPage(vi.fn<typeof fetch>());
    expect(await screen.findByLabelText('管理用パスワード')).toBeInTheDocument();
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
  });

  it('never renders the previous event while a new route session is being checked', async () => {
    const nextEventId = '99999999-9999-4999-8999-999999999999';
    const nextToken = 'next-event-session-token';
    storeSession();
    sessionStorage.setItem(adminSessionStorageKey(nextEventId), writeAdminSession({
      sessionToken: nextToken, expiresAt,
    }));
    let resolveNext: ((response: Response) => void) | undefined;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).includes(nextEventId)) {
        return new Promise<Response>((resolve) => { resolveNext = resolve; });
      }
      return Response.json(adminEvent);
    };
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/events/${eventId}/admin`]}>
      <EventSwitch target={`/events/${nextEventId}/admin`} />
      <Routes><Route path="/events/:eventId/admin" element={
        <AdminEventPage apiBaseUrl="https://api.example.test/api/v1" fetcher={fetcher} />
      } /></Routes>
    </MemoryRouter>);
    await screen.findByRole('heading', { name: adminEvent.title });

    await user.click(screen.getByRole('button', { name: '別のイベントへ' }));
    expect(screen.queryByRole('heading', { name: adminEvent.title })).not.toBeInTheDocument();
    expect(screen.getByText('管理セッションを確認しています…')).toBeInTheDocument();

    resolveNext?.(Response.json({ ...adminEvent, id: nextEventId, title: '12月の別イベント' }));
    expect(await screen.findByRole('heading', { name: '12月の別イベント' })).toBeInTheDocument();
  });

  it('resets pending login state when navigating to another event', async () => {
    const nextEventId = '99999999-9999-4999-8999-999999999999';
    const fetcher: typeof fetch = async () => new Promise<Response>(() => undefined);
    const user = userEvent.setup();
    render(<MemoryRouter initialEntries={[`/events/${eventId}/admin`]}>
      <EventSwitch target={`/events/${nextEventId}/admin`} />
      <Routes><Route path="/events/:eventId/admin" element={
        <AdminEventPage apiBaseUrl="https://api.example.test/api/v1" fetcher={fetcher} />
      } /></Routes>
    </MemoryRouter>);
    const password = await screen.findByLabelText('管理用パスワード');
    await user.type(password, 'event-a-password');
    await user.click(screen.getByRole('button', { name: '管理画面を開く' }));
    expect(screen.getByRole('button', { name: '確認しています…' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '別のイベントへ' }));
    const freshPassword = await screen.findByLabelText('管理用パスワード');
    expect(freshPassword).toHaveValue('');
    await user.type(freshPassword, 'event-b-password');
    expect(screen.getByRole('button', { name: '管理画面を開く' })).toBeEnabled();
  });

  it('updates settings and replaces close/reopen status from API responses', async () => {
    storeSession();
    const calls: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'PATCH') {
        return Response.json({ ...adminEvent, title: '更新後の定例', notifyOnResponse: false, version: 2 });
      }
      if (url.endsWith('/close')) return Response.json({ ...adminEvent, title: '更新後の定例', status: 'closed', version: 3 });
      if (url.endsWith('/reopen')) return Response.json({ ...adminEvent, title: '更新後の定例', status: 'open', version: 4 });
      return Response.json(adminEvent);
    };
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });

    const title = screen.getByLabelText('イベント名');
    await user.clear(title);
    await user.type(title, '更新後の定例');
    await user.click(screen.getByLabelText('回答が届いたらメールで通知する'));
    await user.click(screen.getByRole('button', { name: '変更を保存' }));
    expect(await screen.findByRole('heading', { name: '更新後の定例' })).toBeInTheDocument();
    expect(screen.getByText('変更を保存しました。')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '回答受付を停止' }));
    expect(await screen.findByText('受付停止中')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回答受付を再開' }));
    expect(await screen.findByText('回答受付中')).toBeInTheDocument();
    expect(calls).toEqual([
      `GET https://api.example.test/api/v1/events/${eventId}/admin`,
      `PATCH https://api.example.test/api/v1/events/${eventId}`,
      `POST https://api.example.test/api/v1/events/${eventId}/close`,
      `POST https://api.example.test/api/v1/events/${eventId}/reopen`,
    ]);
  });

  it('shows authenticated field errors next to the rejected setting', async () => {
    storeSession();
    const fetcher: typeof fetch = async (_input, init) => init?.method === 'PATCH'
      ? Response.json({
        code: 'VALIDATION_ERROR', message: '入力内容を確認してください。',
        fieldErrors: { title: ['このイベント名は使用できません。'] }, requestId: 'request-422',
      }, { status: 422 })
      : Response.json(adminEvent);
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const title = screen.getByLabelText('イベント名');
    await user.clear(title);
    await user.type(title, '拒否されるイベント名');
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(await screen.findByText('入力内容を確認してください。')).toBeInTheDocument();
    expect(title).toHaveAccessibleDescription('このイベント名は使用できません。');
  });

  it('clears the session when an authenticated update is denied', async () => {
    storeSession();
    const fetcher: typeof fetch = async (_input, init) => init?.method === 'PATCH'
      ? Response.json({
        code: 'ADMIN_ACCESS_DENIED', message: '管理用の認証情報を確認してください。',
        requestId: 'request-expired',
      }, { status: 404 })
      : Response.json(adminEvent);
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    await user.click(screen.getByRole('button', { name: '変更を保存' }));

    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('管理セッションの有効期限が切れました。');
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
  });

  it('preserves an unsaved settings draft while serializing a status change', async () => {
    storeSession();
    let resolveClose: ((response: Response) => void) | undefined;
    let closeCalls = 0;
    const fetcher: typeof fetch = async (input) => {
      if (String(input).endsWith('/close')) {
        closeCalls += 1;
        return new Promise<Response>((resolve) => { resolveClose = resolve; });
      }
      return Response.json(adminEvent);
    };
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const title = screen.getByLabelText('イベント名');
    await user.clear(title);
    await user.type(title, 'まだ保存していないタイトル');

    await user.click(screen.getByRole('button', { name: '回答受付を停止' }));
    expect(screen.getByRole('button', { name: '保存しています…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '変更しています…' }));
    expect(closeCalls).toBe(1);
    resolveClose?.(Response.json({ ...adminEvent, status: 'closed', version: 2 }));

    expect(await screen.findByRole('button', { name: '回答受付を再開' })).toBeInTheDocument();
    expect(screen.getByLabelText('イベント名')).toHaveValue('まだ保存していないタイトル');
  });

  it('shares only the participant URL and suppresses duplicate share submissions', async () => {
    storeSession();
    const fetcher: typeof fetch = async () => Response.json(adminEvent);
    let release: (() => void) | undefined;
    const share = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    window.history.replaceState({}, '', '/kurukuru-v2/?admin_secret=query-sentinel');
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const button = screen.getByRole('button', { name: '参加者用URLを共有' });

    await user.click(button);
    expect(screen.getByRole('button', { name: '共有しています…' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '共有しています…' }));
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith(expect.objectContaining({
      title: adminEvent.title,
      url: expect.stringMatching(new RegExp(`#\\/events\\/${eventId}$`)),
    }));
    expect(JSON.stringify(share.mock.calls)).not.toContain(token);
    expect(JSON.stringify(share.mock.calls)).not.toContain('query-sentinel');

    release?.();
    await waitFor(() => expect(screen.getByText('参加者用URLを共有しました。')).toBeInTheDocument());
  });

  it('copies through the Clipboard API and leaves a selectable URL fallback visible', async () => {
    storeSession();
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPage(async () => Response.json(adminEvent));
    await screen.findByRole('heading', { name: adminEvent.title });

    const urlField = screen.getByLabelText('参加者用URL');
    expect((urlField as HTMLInputElement).value).toMatch(new RegExp(`#\\/events\\/${eventId}$`));
    await user.click(screen.getByRole('button', { name: '参加者用URLを共有' }));
    expect(writeText).toHaveBeenCalledWith((urlField as HTMLInputElement).value);
    expect(await screen.findByText('参加者用URLをコピーしました。')).toBeInTheDocument();
  });
});
