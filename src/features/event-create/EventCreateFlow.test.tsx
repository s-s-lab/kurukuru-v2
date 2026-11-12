import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { NewEventPage } from '../../pages/NewEventPage';
import { EventCreateFlow } from './EventCreateFlow';
import { EventApiError, type CreateEventResult } from './event-api';

function renderFlow(props: Partial<ComponentProps<typeof EventCreateFlow>> = {}) {
  return render(<EventCreateFlow today="2026-11-01" apiBaseUrl="https://api.example.test/api/v1"
    location={{ origin: 'https://example.test', pathname: '/kurukuru-v2/' }} {...props} />);
}

const createdEvent: CreateEventResult = {
  event: {
    id: 'created-event', title: '11月の定例ミーティング', description: 'みんなで予定を合わせます。', duration: '1時間程度',
    status: 'open', finalization: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    candidateSlots: [{ id: 'slot-1', date: '2026-11-10', slotIndex: 18 }], responses: [],
  },
  emailVerificationRequired: true,
};

async function fillValidDraft(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('イベント名'), '11月の定例ミーティング');
  await user.type(screen.getByLabelText('説明（任意）'), 'みんなで予定を合わせます。');
  await user.type(screen.getByLabelText('所要時間（任意）'), '1時間程度');
  await user.type(screen.getByLabelText('主催者メールアドレス'), 'organizer@example.com');
  await user.type(screen.getByLabelText('管理用パスワード'), 'private-password');
  await user.click(screen.getByLabelText('回答時にメールで通知'));
  await user.click(screen.getByRole('button', { name: '2026年11月10日を候補日に追加' }));
  await user.click(screen.getByRole('button', { name: '2026年11月10日 09:00〜09:30 選択' }));
}

describe('イベント作成の一画面フロー', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('基本情報、2か月カレンダー、候補時間表、作成操作を同時に表示する', () => {
    render(<MemoryRouter><NewEventPage /></MemoryRouter>);
    expect(screen.queryByRole('list', { name: 'イベント作成の進捗' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('イベント名')).toBeInTheDocument();
    expect(screen.getByLabelText('所要時間（任意）')).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /のカレンダー/ })).toHaveLength(2);
    const timeline = screen.getByRole('table', { name: '候補日時の選択' });
    expect(timeline).toBeInTheDocument();
    expect(within(timeline).getByRole('columnheader', { name: '06' })).toHaveAttribute('title', '06:00');
    expect(timeline).not.toHaveTextContent('06:30');
    expect(screen.getByRole('button', { name: '日程調整を作成' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '次へ' })).not.toBeInTheDocument();
  });

  it('作成時に基本情報と候補日時をまとめて検証する', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByLabelText('イベント名')).toHaveAccessibleDescription('イベント名を入力してください。');
    expect(screen.getByLabelText('主催者メールアドレス')).toHaveAccessibleDescription('有効なメールアドレスを入力してください。');
    expect(screen.getByLabelText('管理用パスワード')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('候補日は1日以上20日以内で選択してください。')).toBeInTheDocument();
  });

  it('カレンダー、時間セル、一括時間帯を一画面のまま編集できる', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('button', { name: '2026年11月10日を候補日に追加' }));
    await user.click(screen.getByRole('button', { name: '2026年11月12日を候補日に追加' }));
    await user.selectOptions(screen.getByLabelText('開始時刻'), '18');
    await user.selectOptions(screen.getByLabelText('終了時刻'), '22');
    await user.click(screen.getByRole('button', { name: '全候補日に追加' }));
    expect(screen.getByRole('status', { name: '時間帯の一括操作結果' }))
      .toHaveTextContent('2日分に09:00〜11:00を追加しました。');
    expect(screen.getByRole('button', { name: '2026年11月10日 10:30〜11:00 選択' }))
      .toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2026年11月12日 10:30〜11:00 選択' }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  it('正規化した内容を一度だけ送信し、成功画面へ切り替える', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (result: CreateEventResult) => void;
    const createEventRequest = vi.fn(() => new Promise<CreateEventResult>((resolve) => { resolveRequest = resolve; }));
    renderFlow({ createEventRequest, createIdempotencyKey: () => 'submission-key' });
    await fillValidDraft(user);
    const submit = screen.getByRole('button', { name: '日程調整を作成' });
    await user.dblClick(submit);
    expect(createEventRequest).toHaveBeenCalledTimes(1);
    expect(createEventRequest).toHaveBeenCalledWith({
      title: '11月の定例ミーティング', description: 'みんなで予定を合わせます。', duration: '1時間程度',
      organizerEmail: 'organizer@example.com', adminPassword: 'private-password',
      notifyOnResponse: false, candidateSlots: [{ date: '2026-11-10', slotIndexes: [18] }],
    }, { apiBaseUrl: 'https://api.example.test/api/v1', idempotencyKey: 'submission-key' });
    expect(submit).toBeDisabled();
    expect(screen.getByText('作成しています…')).toHaveAttribute('role', 'status');
    await act(async () => { resolveRequest(createdEvent); });
    expect(screen.getByRole('heading', { name: '日程調整を作成しました' })).toBeInTheDocument();
    expect(localStorage.getItem('kurukuru:created-events')).toContain('created-event');
    expect(localStorage.getItem('kurukuru:created-events')).not.toContain('private-password');
  });

  it('安全なAPIエラーを表示し、変更なしの再試行では同じ冪等キーを使う', async () => {
    const user = userEvent.setup();
    const createEventRequest = vi.fn().mockRejectedValueOnce(new EventApiError(503, {
      code: 'SERVICE_UNAVAILABLE', message: 'しばらくしてからお試しください。', requestId: 'request-safe-123',
    })).mockResolvedValue(createdEvent);
    const createIdempotencyKey = vi.fn(() => 'retry-key');
    renderFlow({ createEventRequest, createIdempotencyKey });
    await fillValidDraft(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('しばらくしてからお試しください。');
    expect(screen.getByRole('alert')).toHaveTextContent('request-safe-123');
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(createEventRequest.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['retry-key', 'retry-key']);
  });

  it('入力変更後の再試行では新しい冪等キーを使う', async () => {
    const user = userEvent.setup();
    const createEventRequest = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue(createdEvent);
    const createIdempotencyKey = vi.fn().mockReturnValueOnce('old-key').mockReturnValueOnce('new-key');
    renderFlow({ createEventRequest, createIdempotencyKey });
    await fillValidDraft(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    await user.type(screen.getByLabelText('イベント名'), ' 更新');
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(createEventRequest.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['old-key', 'new-key']);
  });

  it('エラー本文へ管理パスワードを露出しない', async () => {
    const user = userEvent.setup();
    const { container } = renderFlow({ createEventRequest: vi.fn().mockRejectedValue(new Error('private-password')) });
    await fillValidDraft(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('イベントを作成できませんでした');
    expect(container.textContent).not.toContain('private-password');
  });

  it('作成後に参加者用と候補日時管理用のURLを案内してコピーできる', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn().mockResolvedValue(undefined);
    renderFlow({ createEventRequest: vi.fn().mockResolvedValue(createdEvent), copyText });
    await fillValidDraft(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('textbox', { name: '参加者用URL' }))
      .toHaveValue('https://example.test/kurukuru-v2/#/events/created-event');
    expect(screen.getByRole('textbox', { name: '主催者用URL' }))
      .toHaveValue('https://example.test/kurukuru-v2/#/events/created-event/admin');
    expect(screen.getByRole('link', { name: '回答ボードを開く' }))
      .toHaveAttribute('href', 'https://example.test/kurukuru-v2/#/events/created-event');
    await user.click(within(screen.getByRole('group', { name: '参加者用URL' }))
      .getByRole('button', { name: 'URLをコピー' }));
    expect(copyText).toHaveBeenCalledWith('https://example.test/kurukuru-v2/#/events/created-event');
  });
});
