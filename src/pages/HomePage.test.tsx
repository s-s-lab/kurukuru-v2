import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HomePage } from './HomePage';

const item = (eventId: string, title: string) => ({
  eventId, title, createdAt: '2026-11-05T10:00:00.000Z',
  participantUrl: `https://example.test/#/events/${eventId}`,
  organizerUrl: `https://example.test/#/events/${eventId}/admin`,
});
const seed = () => localStorage.setItem('kurukuru:created-events', JSON.stringify([
  item('first', '定例会'), item('second', '相談会'),
]));
const renderHome = () => render(<MemoryRouter><HomePage /></MemoryRouter>);

describe('ホームの作成イベント履歴の削除', () => {
  beforeEach(() => { localStorage.clear(); seed(); });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });

  it('確認を取り消すと行と保存内容が残る', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));
    expect(screen.getByText('定例会')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('kurukuru:created-events')!)).toHaveLength(2);
  });

  it('影響範囲を確認して対象行だけ削除し、次の削除ボタンへフォーカスを移す', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const fetcher = vi.spyOn(globalThis, 'fetch');
    sessionStorage.setItem('kurukuru:admin-session:first', 'keep');
    const view = renderHome();
    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringMatching(/定例会.*このブラウザの履歴.*イベントや回答は削除されません.*候補日時管理.*表示されなく.*URL.*保存/s));
    expect(screen.queryByText('定例会')).not.toBeInTheDocument();
    expect(screen.getByText('このブラウザの直近1件')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '「相談会」を履歴から削除' })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('「定例会」を履歴から削除しました');
    expect(sessionStorage.getItem('kurukuru:admin-session:first')).toBe('keep');
    expect(fetcher).not.toHaveBeenCalled();
    view.unmount();
    renderHome();
    expect(screen.queryByText('定例会')).not.toBeInTheDocument();
    expect(screen.getByText('相談会')).toBeInTheDocument();
  });

  it('末尾の行を削除すると前の行へ、最後の行を削除すると作成リンクへフォーカスを移す', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHome();
    await userEvent.click(screen.getByRole('button', { name: '「相談会」を履歴から削除' }));
    expect(screen.getByRole('button', { name: '「定例会」を履歴から削除' })).toHaveFocus();
    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));
    expect(screen.queryByRole('region', { name: 'このブラウザで作成したイベント' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('「定例会」を履歴から削除しました');
    expect(screen.getByRole('link', { name: '日程調整を作成' })).toHaveFocus();
    expect(JSON.parse(localStorage.getItem('kurukuru:created-events')!)).toEqual([]);
  });

  it('保存に失敗すると行を残して失敗を伝える', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHome();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));
    expect(screen.getByText('定例会')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('履歴から削除できませんでした');
    expect(screen.getByRole('button', { name: '「定例会」を履歴から削除' })).toHaveFocus();
  });

  it('表示後に別の保存があっても新しい行を失わない', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHome();
    localStorage.setItem('kurukuru:created-events', JSON.stringify([
      item('third', '新しい会議'), item('first', '定例会'), item('second', '相談会'),
    ]));
    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));
    const region = screen.getByRole('region', { name: 'このブラウザで作成したイベント' });
    expect(within(region).getByText('新しい会議')).toBeInTheDocument();
    expect(within(region).getByText('相談会')).toBeInTheDocument();
  });

  it('削除内容の保存後に読み出しが失敗しても、残りの行を表示し続ける', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderHome();
    const stored = localStorage.getItem('kurukuru:created-events');
    const read = vi.spyOn(Storage.prototype, 'getItem')
      .mockReturnValueOnce(stored)
      .mockImplementation(() => { throw new Error('temporary read failure'); });

    await userEvent.click(screen.getByRole('button', { name: '「定例会」を履歴から削除' }));

    expect(read).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('定例会')).not.toBeInTheDocument();
    expect(screen.getByText('相談会')).toBeInTheDocument();
  });
});
