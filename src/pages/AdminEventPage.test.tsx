import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminEvent } from '../../functions/admin/service';
import { adminSessionStorageKey, writeAdminSession } from '../features/event-admin/admin-session';
import { AdminEventPage } from './AdminEventPage';

const eventId = '11111111-1111-4111-8111-111111111111';
const slotId = '22222222-2222-4222-8222-222222222222';
const token = 'opaque-admin-session-token';
const expiresAt = '2099-11-02T12:00:00.000Z';
const adminEvent: AdminEvent = {
  id: eventId, title: '11月のプロジェクト定例', description: '説明', duration: '1時間程度',
  organizerEmail: 'owner@example.com', organizerEmailVerified: true,
  notifyOnResponse: true, status: 'open', finalization: null, version: 1,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }], responses: [],
};

function renderPage(fetcher: typeof fetch) {
  return render(<MemoryRouter initialEntries={[`/events/${eventId}/admin`]}>
    <Routes><Route path="/events/:eventId/admin" element={
      <AdminEventPage apiBaseUrl="https://api.example.test/api/v1" fetcher={fetcher} today="2026-11-05" />
    } /></Routes>
  </MemoryRouter>);
}

function storeSession(value = { sessionToken: token, expiresAt }) {
  sessionStorage.setItem(adminSessionStorageKey(eventId), writeAdminSession(value));
}

describe('候補日時専用の管理ページ', () => {
  beforeEach(() => sessionStorage.clear());
  afterEach(cleanup);

  it('認証前はイベント情報を出さず管理パスワードを求める', async () => {
    renderPage(vi.fn<typeof fetch>());
    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(screen.getByLabelText('管理用パスワード')).toBeInTheDocument();
    expect(screen.queryByText(adminEvent.title)).not.toBeInTheDocument();
  });

  it('ログイン後は候補日時編集と公開ボード導線だけを管理機能として表示する', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      sessionToken: token, expiresAt, event: adminEvent,
    }, { status: 201 }));
    const user = userEvent.setup();
    renderPage(fetcher);
    await user.type(await screen.findByLabelText('管理用パスワード'), 'private-password');
    await user.click(screen.getByRole('button', { name: '管理画面を開く' }));

    expect(await screen.findByRole('heading', { name: adminEvent.title })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '候補日時を編集' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /公開回答ボードへ戻る/ }))
      .toHaveAttribute('href', expect.stringMatching(new RegExp(`#/events/${eventId}$`)));
    expect(screen.queryByText('回答状況')).not.toBeInTheDocument();
    expect(screen.queryByText('イベント設定')).not.toBeInTheDocument();
    expect(screen.queryByText('メールアドレス確認')).not.toBeInTheDocument();
    expect(screen.queryByText('イベントを削除')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-password');
    expect(document.body.textContent).not.toContain(token);
  });

  it('保存済みセッションを復元し、拒否されたセッションは削除する', async () => {
    storeSession();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({
      code: 'ADMIN_ACCESS_DENIED', message: '管理用の認証情報を確認してください。',
      requestId: 'request-denied',
    }, { status: 404 }));
    renderPage(fetcher);
    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('管理セッションの有効期限が切れました。');
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
  });

  it('期限切れセッションでは認証リクエストを送らない', async () => {
    storeSession({ sessionToken: token, expiresAt: '2000-01-01T00:00:00.000Z' });
    const fetcher = vi.fn<typeof fetch>();
    renderPage(fetcher);
    expect(await screen.findByLabelText('管理用パスワード')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('候補日を追加して正規化した候補日時だけを保存する', async () => {
    storeSession();
    const requests: unknown[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/candidate-slots')) {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json({
          ...adminEvent, version: 2,
          candidateSlots: [
            ...adminEvent.candidateSlots,
            { id: '44444444-4444-4444-8444-444444444444', date: '2026-11-12', slotIndex: 20 },
          ],
        });
      }
      return Response.json(adminEvent);
    };
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    expect(screen.getAllByRole('group', { name: /のカレンダー/ })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: '2026年11月12日を候補日に追加' }));
    await user.click(screen.getByRole('button', { name: '2026年11月12日 10:00〜10:30 選択' }));
    await user.click(screen.getByRole('button', { name: '候補日時を保存' }));

    expect(await screen.findByText('候補日時を保存しました。公開回答ボードにも反映されています。')).toBeInTheDocument();
    expect(requests).toEqual([{ candidateSlots: [
      { date: '2026-11-10', slotIndexes: [18] },
      { date: '2026-11-12', slotIndexes: [20] },
    ] }]);
  });

  it('選択した時間帯をすべての候補日にまとめて追加して保存する', async () => {
    storeSession();
    const requests: unknown[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input).endsWith('/candidate-slots')) {
        requests.push(JSON.parse(String(init?.body)));
        return Response.json(adminEvent);
      }
      return Response.json(adminEvent);
    };
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    await user.click(screen.getByRole('button', { name: '2026年11月12日を候補日に追加' }));
    await user.selectOptions(screen.getByLabelText('開始時刻'), '18');
    await user.selectOptions(screen.getByLabelText('終了時刻'), '22');
    await user.click(screen.getByRole('button', { name: '全候補日に追加' }));
    await user.click(screen.getByRole('button', { name: '候補日時を保存' }));

    expect(requests).toEqual([{ candidateSlots: [
      { date: '2026-11-10', slotIndexes: [18, 19, 20, 21] },
      { date: '2026-11-12', slotIndexes: [18, 19, 20, 21] },
    ] }]);
  });

  it('時間セルをクリックしてドラッグすると通過した候補時間をまとめて選択する', async () => {
    storeSession();
    const fetcher: typeof fetch = async () => Response.json(adminEvent);
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const start = screen.getByRole('button', { name: /11月10日 09:30〜10:00 選択/ });
    const middle = screen.getByRole('button', { name: /11月10日 10:00〜10:30 選択/ });
    const end = screen.getByRole('button', { name: /11月10日 10:30〜11:00 選択/ });

    fireEvent.pointerDown(start, { pointerId: 1, button: 0 });
    fireEvent.pointerMove(middle, { pointerId: 1, buttons: 1 });
    fireEvent.pointerMove(end, { pointerId: 1, buttons: 1 });
    fireEvent.pointerUp(end, { pointerId: 1, button: 0 });

    expect(start).toHaveAttribute('aria-pressed', 'true');
    expect(middle).toHaveAttribute('aria-pressed', 'true');
    expect(end).toHaveAttribute('aria-pressed', 'true');
  });

  it('保存中は候補日の追加と時間帯の編集を無効にして送信中の内容を保つ', async () => {
    storeSession();
    let resolveUpdate!: (response: Response) => void;
    const fetcher: typeof fetch = async (_input, init) => init?.method === 'PUT'
      ? new Promise<Response>((resolve) => { resolveUpdate = resolve; })
      : Response.json(adminEvent);
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const addDate = screen.getByRole('button', { name: '2026年11月12日を候補日に追加' });
    const timeCell = screen.getByRole('button', { name: /11月10日 09:30〜10:00 選択/ });
    const saveButton = screen.getByRole('button', { name: '候補日時を保存' });

    await user.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(addDate).toBeDisabled();
    expect(timeCell).toBeDisabled();
    expect(screen.getByLabelText('開始時刻')).toBeDisabled();
    expect(screen.getByLabelText('終了時刻')).toBeDisabled();
    expect(screen.getByRole('button', { name: '全候補日に追加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'すべて解除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2026年11月10日を削除' })).toBeDisabled();
    await user.click(timeCell);
    expect(timeCell).toHaveAttribute('aria-pressed', 'false');

    await act(async () => { resolveUpdate(Response.json(adminEvent)); });
    expect(await screen.findByText('候補日時を保存しました。公開回答ボードにも反映されています。')).toBeInTheDocument();
  });

  it('選択済みの時間セルからドラッグすると通過した候補時間をまとめて解除する', async () => {
    storeSession();
    const eventWithRange = {
      ...adminEvent,
      candidateSlots: [
        { id: '22222222-2222-4222-8222-222222222218', date: '2026-11-10', slotIndex: 18 },
        { id: '22222222-2222-4222-8222-222222222219', date: '2026-11-10', slotIndex: 19 },
        { id: '22222222-2222-4222-8222-222222222220', date: '2026-11-10', slotIndex: 20 },
      ],
    };
    const fetcher: typeof fetch = async () => Response.json(eventWithRange);
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    const start = screen.getByRole('button', { name: /11月10日 09:00〜09:30 選択/ });
    const middle = screen.getByRole('button', { name: /11月10日 09:30〜10:00 選択/ });
    const end = screen.getByRole('button', { name: /11月10日 10:00〜10:30 選択/ });

    fireEvent.pointerDown(start, { pointerId: 2, button: 0 });
    fireEvent.pointerMove(middle, { pointerId: 2, buttons: 1 });
    fireEvent.pointerMove(end, { pointerId: 2, buttons: 1 });
    fireEvent.pointerUp(end, { pointerId: 2, button: 0 });

    expect(start).toHaveAttribute('aria-pressed', 'false');
    expect(middle).toHaveAttribute('aria-pressed', 'false');
    expect(end).toHaveAttribute('aria-pressed', 'false');
  });

  it('候補日時更新で認証が切れた場合はログインへ戻す', async () => {
    storeSession();
    const fetcher: typeof fetch = async (_input, init) => init?.method === 'PUT'
      ? Response.json({
        code: 'ADMIN_ACCESS_DENIED', message: '管理用の認証情報を確認してください.',
        requestId: 'request-expired',
      }, { status: 404 })
      : Response.json(adminEvent);
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: adminEvent.title });
    await user.click(screen.getByRole('button', { name: '候補日時を保存' }));
    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
    expect(sessionStorage.getItem(adminSessionStorageKey(eventId))).toBeNull();
  });
});
