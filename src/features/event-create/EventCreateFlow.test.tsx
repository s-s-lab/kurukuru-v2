import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';

import { NewEventPage } from '../../pages/NewEventPage';
import { EventCreateFlow } from './EventCreateFlow';
import { createEvent, EventApiError, type CreateEventResult } from './event-api';

function renderFlow(props: Partial<ComponentProps<typeof EventCreateFlow>> = {}) {
  return render(<EventCreateFlow today="2026-11-01" apiBaseUrl="https://api.example.test/api/v1"
    location={{ origin: 'https://example.test', pathname: '/kurukuru-v2/' }} {...props} />);
}

async function fillBasicInformation(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('イベント名'), '11月の定例ミーティング');
  await user.type(screen.getByLabelText('説明（任意）'), 'みんなで予定を合わせます。');
  await user.type(screen.getByLabelText('主催者メールアドレス'), 'organizer@example.com');
  await user.type(screen.getByLabelText('管理用パスワード'), 'private-password');
  await user.click(screen.getByLabelText('回答時にメールで通知'));
  await user.click(screen.getByRole('button', { name: '次へ' }));
}

async function addDate(user: ReturnType<typeof userEvent.setup>) {
  await user.clear(screen.getByLabelText('候補日'));
  await user.type(screen.getByLabelText('候補日'), '2026-11-10');
  await user.click(screen.getByRole('button', { name: '候補日を追加' }));
}

describe('イベント作成の基本情報と候補日時', () => {
  afterEach(cleanup);

  it('プレースホルダーを置き換え、3段階の進捗と現在の段階を表示する', () => {
    render(<MemoryRouter><NewEventPage /></MemoryRouter>);
    expect(screen.queryByText('イベント作成フローはP4で実装します。')).not.toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'イベント作成の進捗' });
    expect(within(steps).getAllByRole('listitem')).toHaveLength(3);
    expect(within(steps).getByText('基本情報').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(within(steps).getByText('候補日時')).toBeInTheDocument();
    expect(within(steps).getByText('確認')).toBeInTheDocument();
  });

  it('必須項目が空なら関連付けられたエラーを示して基本情報に留まる', async () => {
    const user = userEvent.setup();
    renderFlow();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByLabelText('イベント名')).toHaveAccessibleDescription('イベント名を入力してください。');
    expect(screen.getByLabelText('主催者メールアドレス')).toHaveAccessibleDescription('有効なメールアドレスを入力してください。');
    expect(screen.getByLabelText('管理用パスワード')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('入力内容を確認してください。');
  });

  it('有効な情報で候補日時へ進み、パスワードを本文へ露出しない', async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    expect(screen.getByLabelText('主催者メールアドレス')).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText('管理用パスワード')).toHaveAttribute('autocomplete', 'new-password');
    await fillBasicInformation(user);
    expect(screen.getByRole('heading', { name: '候補日時を選択してください' })).toBeInTheDocument();
    expect(container.textContent).not.toContain('private-password');
    expect(screen.getByLabelText('候補日')).toHaveAttribute('min', '2026-11-01');
  });

  it('候補日は1行だけ追加し、36個の時間をクリックとキーボードで選択できる', async () => {
    const user = userEvent.setup();
    renderFlow();
    await fillBasicInformation(user);
    await addDate(user);
    const table = screen.getByRole('table', { name: '候補日時の選択' });
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    const cells = within(table).getAllByRole('button', { name: /選択$/ });
    expect(cells).toHaveLength(36);
    expect(cells[0]).toHaveAccessibleName('11月10日 06:00〜06:30 選択');
    expect(cells[35]).toHaveAccessibleName('11月10日 23:30〜24:00 選択');
    const slot = screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' });
    await user.click(slot);
    expect(slot).toHaveAttribute('aria-pressed', 'true');
    slot.focus();
    await user.keyboard(' ');
    expect(slot).toHaveAttribute('aria-pressed', 'false');
    await user.keyboard('{Enter}');
    expect(slot).toHaveAttribute('aria-pressed', 'true');
    await addDate(user);
    expect(screen.getByText('同じ候補日を重複して指定できません。')).toBeInTheDocument();
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('ドラッグで通過した時間を同じ選択状態に塗り、次のクリックでも選択を解除できる', async () => {
    const user = userEvent.setup();
    renderFlow();
    await fillBasicInformation(user);
    await addDate(user);
    const first = screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' });
    const next = screen.getByRole('button', { name: '11月10日 09:30〜10:00 選択' });
    await user.pointer([
      { keys: '[MouseLeft>]', target: first },
      { target: next },
      { keys: '[/MouseLeft]', target: next },
    ]);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(next).toHaveAttribute('aria-pressed', 'true');
    await user.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'false');
  });

  it('候補日と各日の時間が必要で、日付を削除できる', async () => {
    const user = userEvent.setup();
    renderFlow();
    await fillBasicInformation(user);
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('候補日は1日以上20日以内で選択してください。')).toBeInTheDocument();
    await addDate(user);
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByText('各候補日に時間を1つ以上選択してください。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '11月10日を削除' }));
    expect(screen.queryByRole('button', { name: '11月10日 09:00〜09:30 選択' })).not.toBeInTheDocument();
  });

  it('戻る操作で全基本項目と候補時間を保持する', async () => {
    const user = userEvent.setup();
    renderFlow();
    await fillBasicInformation(user);
    await addDate(user);
    await user.click(screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' }));
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByLabelText('イベント名')).toHaveValue('11月の定例ミーティング');
    expect(screen.getByLabelText('説明（任意）')).toHaveValue('みんなで予定を合わせます。');
    expect(screen.getByLabelText('主催者メールアドレス')).toHaveValue('organizer@example.com');
    expect(screen.getByLabelText('管理用パスワード')).toHaveValue('private-password');
    expect(screen.getByLabelText('管理用パスワード')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('回答時にメールで通知')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' })).toHaveAttribute('aria-pressed', 'true');
  });
});

const createdEvent: CreateEventResult = {
  event: {
    id: 'created-event', title: '11月の定例ミーティング', description: 'みんなで予定を合わせます。',
    status: 'open', finalization: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
    candidateSlots: [{ id: 'slot-1', date: '2026-11-10', slotIndex: 18 }], responses: [],
  },
  emailVerificationRequired: true,
};

async function reachConfirmation(user: ReturnType<typeof userEvent.setup>) {
  await fillBasicInformation(user);
  await addDate(user);
  for (const time of ['09:00〜09:30', '09:30〜10:00', '10:00〜10:30', '23:30〜24:00']) {
    await user.click(screen.getByRole('button', { name: `11月10日 ${time} 選択` }));
  }
  await user.click(screen.getByRole('button', { name: '次へ' }));
}

describe('イベント作成の確認・送信・共有', () => {
  afterEach(cleanup);

  it('前後のステップと作成成功へ遷移したら新しい見出しへフォーカスを移す', async () => {
    const user = userEvent.setup();
    renderFlow({ createEventRequest: vi.fn().mockResolvedValue(createdEvent) });
    await fillBasicInformation(user);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '候補日時を選択してください' }));
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '基本情報を入力してください' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await addDate(user);
    await user.click(screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '内容を確認してください' }));
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '候補日時を選択してください' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '日程調整を作成しました' }));
  });

  it('構造不正の成功JSONを安全なエラーにし、全下書きを保持して同じキーで再試行する', async () => {
    const user = userEvent.setup();
    const calls: Array<{ key: string | null; body: string }> = [];
    const validResult = { ...createdEvent, event: { ...createdEvent.event,
      id: '9bed1489-b31f-4b6d-8dcb-e8d95109f98c',
      candidateSlots: [{ id: '150da5e0-f923-492c-be9b-263bf5af58fc', date: '2026-11-10', slotIndex: 18 }],
    } };
    const fetcher: typeof fetch = async (_input, init) => {
      calls.push({ key: new Headers(init?.headers).get('idempotency-key'), body: String(init?.body) });
      return Response.json(calls.length === 1 ? { event: {}, debug: 'private upstream content' } : validResult, { status: 201 });
    };
    const createIdempotencyKey = vi.fn(() => 'invalid-response-retry-key');
    const { container } = renderFlow({ createIdempotencyKey,
      createEventRequest: (request, options) => createEvent(request, { ...options, fetcher }),
    });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('イベントを作成できませんでした。時間をおいて再度お試しください。');
    expect(container.textContent).not.toContain('private upstream content');
    expect(screen.getByRole('region', { name: '内容を確認してください' })).toHaveTextContent('11月の定例ミーティング');
    expect(screen.queryByRole('heading', { name: '日程調整を作成しました' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '戻る' }));
    for (const time of ['09:00〜09:30', '09:30〜10:00', '10:00〜10:30', '23:30〜24:00']) {
      expect(screen.getByRole('button', { name: `11月10日 ${time} 選択` })).toHaveAttribute('aria-pressed', 'true');
    }
    await user.click(screen.getByRole('button', { name: '戻る' }));
    expect(screen.getByLabelText('イベント名')).toHaveValue('11月の定例ミーティング');
    expect(screen.getByLabelText('説明（任意）')).toHaveValue('みんなで予定を合わせます。');
    expect(screen.getByLabelText('主催者メールアドレス')).toHaveValue('organizer@example.com');
    expect(screen.getByLabelText('管理用パスワード')).toHaveValue('private-password');
    expect(screen.getByLabelText('回答時にメールで通知')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('textbox', { name: '参加者用URL' })).toHaveValue('https://example.test/kurukuru-v2/#/events/9bed1489-b31f-4b6d-8dcb-e8d95109f98c');
    expect(calls.map((call) => call.key)).toEqual(['invalid-response-retry-key', 'invalid-response-retry-key']);
    expect(calls[1].body).toBe(calls[0].body);
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
  });

  it('有効な選択で確認へ進み、秘密を含まない要約と連続範囲を表示し、戻ると選択を復元する', async () => {
    const user = userEvent.setup();
    const { container } = renderFlow();
    await reachConfirmation(user);
    const confirmation = screen.getByRole('region', { name: '内容を確認してください' });
    expect(confirmation).toHaveTextContent('11月の定例ミーティング');
    expect(confirmation).toHaveTextContent('みんなで予定を合わせます。');
    expect(confirmation).toHaveTextContent('organizer@example.com');
    expect(confirmation).toHaveTextContent('通知しない');
    expect(confirmation).toHaveTextContent('2026年11月10日');
    const ranges = within(confirmation).getByRole('list', { name: '2026年11月10日の候補時間' });
    expect(within(ranges).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['09:00〜10:30', '23:30〜24:00']);
    expect(container.innerHTML).not.toContain('private-password');
    expect(screen.queryByLabelText('管理用パスワード')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '戻る' }));
    for (const time of ['09:00〜09:30', '09:30〜10:00', '10:00〜10:30', '23:30〜24:00']) {
      expect(screen.getByRole('button', { name: `11月10日 ${time} 選択` })).toHaveAttribute('aria-pressed', 'true');
    }
  });

  it('正規化したリクエストを一度送信し、処理中の再送と戻る操作を無効にする', async () => {
    const user = userEvent.setup();
    let resolveRequest!: (result: CreateEventResult) => void;
    const createEventRequest = vi.fn(() => new Promise<CreateEventResult>((resolve) => { resolveRequest = resolve; }));
    renderFlow({ createEventRequest, createIdempotencyKey: () => 'submission-key' });
    await fillBasicInformation(user);
    await user.click(screen.getByRole('button', { name: '戻る' }));
    await user.clear(screen.getByLabelText('イベント名'));
    await user.type(screen.getByLabelText('イベント名'), '  調整会議  ');
    await user.clear(screen.getByLabelText('説明（任意）'));
    await user.type(screen.getByLabelText('説明（任意）'), '  説明文  ');
    await user.clear(screen.getByLabelText('主催者メールアドレス'));
    await user.type(screen.getByLabelText('主催者メールアドレス'), 'Organizer@Example.COM');
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await addDate(user);
    await user.click(screen.getByRole('button', { name: '11月10日 10:00〜10:30 選択' }));
    await user.click(screen.getByRole('button', { name: '11月10日 09:00〜09:30 選択' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    const submit = screen.getByRole('button', { name: '日程調整を作成' });
    await user.dblClick(submit);
    expect(createEventRequest).toHaveBeenCalledTimes(1);
    expect(createEventRequest).toHaveBeenCalledWith({
      title: '調整会議', description: '説明文', organizerEmail: 'organizer@example.com',
      adminPassword: 'private-password', notifyOnResponse: false,
      candidateSlots: [{ date: '2026-11-10', slotIndexes: [18, 20] }],
    }, { apiBaseUrl: 'https://api.example.test/api/v1', idempotencyKey: 'submission-key' });
    expect(submit).toBeDisabled();
    expect(screen.getByRole('button', { name: '戻る' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('作成しています');
    await act(async () => { resolveRequest(createdEvent); });
    expect(screen.getByRole('heading', { name: '日程調整を作成しました' })).toBeInTheDocument();
  });

  it('APIの安全なエラーとリクエストIDを示し、変更なしの再試行は同じキーを使う', async () => {
    const user = userEvent.setup();
    const createEventRequest = vi.fn().mockRejectedValueOnce(new EventApiError(503, {
      code: 'SERVICE_UNAVAILABLE', message: 'しばらくしてからお試しください。', requestId: 'request-safe-123',
    })).mockResolvedValue(createdEvent);
    const createIdempotencyKey = vi.fn(() => 'retry-key');
    renderFlow({ createEventRequest, createIdempotencyKey });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('しばらくしてからお試しください。');
    expect(screen.getByRole('alert')).toHaveTextContent('request-safe-123');
    await user.click(screen.getByRole('button', { name: '戻る' }));
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(createIdempotencyKey).toHaveBeenCalledTimes(1);
    expect(createEventRequest.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['retry-key', 'retry-key']);
    expect(screen.getByRole('heading', { name: '日程調整を作成しました' })).toBeInTheDocument();
  });

  it.each(['basic', 'candidate'] as const)('戻って%sを変更すると次の送信では新しいキーを使う', async (edit) => {
    const user = userEvent.setup();
    const createEventRequest = vi.fn().mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValue(createdEvent);
    const createIdempotencyKey = vi.fn().mockReturnValueOnce('old-key').mockReturnValueOnce('new-key');
    renderFlow({ createEventRequest, createIdempotencyKey });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    await user.click(screen.getByRole('button', { name: '戻る' }));
    if (edit === 'basic') {
      await user.click(screen.getByRole('button', { name: '戻る' }));
      await user.type(screen.getByLabelText('イベント名'), '（更新）');
      await user.click(screen.getByRole('button', { name: '次へ' }));
    } else {
      await user.click(screen.getByRole('button', { name: '11月10日 11:00〜11:30 選択' }));
    }
    await user.click(screen.getByRole('button', { name: '次へ' }));
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(createEventRequest.mock.calls.map((call) => call[1].idempotencyKey)).toEqual(['old-key', 'new-key']);
    expect(screen.getByRole('heading', { name: '日程調整を作成しました' })).toBeInTheDocument();
  });

  it.each([new Error('private-password'), new EventApiError(500, {
    code: 'INTERNAL_ERROR', message: 'private-password', requestId: 'private-password',
  })])('失敗の内部詳細やパスワードを反映しない', async (error) => {
    const user = userEvent.setup();
    const { container } = renderFlow({ createEventRequest: vi.fn().mockRejectedValue(error) });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('イベントを作成できませんでした');
    expect(container.innerHTML).not.toContain('private-password');
    expect(screen.getByRole('button', { name: '日程調整を作成' })).toBeEnabled();
  });

  it('参加者と主催者のURLをそれぞれコピーし、保存警告と読み上げ可能な完了を示す', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn().mockResolvedValue(undefined);
    const { container } = renderFlow({ createEventRequest: vi.fn().mockResolvedValue(createdEvent), copyText });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    expect(screen.getByRole('textbox', { name: '参加者用URL' })).toHaveValue('https://example.test/kurukuru-v2/#/events/created-event');
    expect(screen.getByRole('textbox', { name: '主催者用URL' })).toHaveValue('https://example.test/kurukuru-v2/#/events/created-event/admin');
    expect(screen.getByText('主催者用URLは必ず保存してください')).toBeInTheDocument();
    for (const label of ['参加者用URL', '主催者用URL']) {
      await user.click(within(screen.getByRole('group', { name: label })).getByRole('button', { name: 'URLをコピー' }));
      expect(screen.getByRole('status')).toHaveTextContent(`${label}をコピーしました。`);
      expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    }
    expect(copyText.mock.calls).toEqual([
      ['https://example.test/kurukuru-v2/#/events/created-event'],
      ['https://example.test/kurukuru-v2/#/events/created-event/admin'],
    ]);
    expect(screen.getByRole('link', { name: 'トップへ戻る' })).toHaveAttribute('href', '#/');
    expect(container.innerHTML).not.toContain('private-password');
    expect(screen.queryByRole('button', { name: '日程調整を作成' })).not.toBeInTheDocument();
  });

  it('コピー失敗を読み上げて手動コピーを案内し、再試行できる', async () => {
    const user = userEvent.setup();
    const copyText = vi.fn().mockRejectedValueOnce(new Error('clipboard denied')).mockResolvedValue(undefined);
    renderFlow({ createEventRequest: vi.fn().mockResolvedValue(createdEvent), copyText });
    await reachConfirmation(user);
    await user.click(screen.getByRole('button', { name: '日程調整を作成' }));
    const copy = within(screen.getByRole('group', { name: '参加者用URL' })).getByRole('button', { name: 'URLをコピー' });
    await user.click(copy);
    expect(screen.getByRole('status')).toHaveTextContent('コピーできませんでした。URLを選択してコピーしてください。');
    await user.click(copy);
    expect(screen.getByRole('status')).toHaveTextContent('参加者用URLをコピーしました。');
  });
});
