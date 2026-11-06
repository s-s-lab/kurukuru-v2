import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';

describe('Kurukuruの入口', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(cleanup);
  it('サービスの価値とイベント作成導線を表示する', () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );

    expect(screen.getByText('30分単位の日程調整ツール　―参加者が回答すると通知がくるくる！')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '候補時間を選んで、URLを共有。' })).toBeInTheDocument();
    expect(screen.getByText(/30分単位の日程調整ツール\s*―参加者が回答すると通知がくるくる！/)).toBeInTheDocument();
    expect(screen.getByText(/ひとつの公開ボードで比べられます/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '回答ボードの表示例' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '日程調整を作成' })).toHaveAttribute(
      'href',
      '#/events/new',
    );
    expect(screen.getByText('Kurukuru — 予定を、時間で合わせる。')).toBeInTheDocument();
    expect(screen.queryByText(/Kurukuru v2/)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ご利用にあたって' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'ネクストトントン' }))
      .toHaveAttribute('href', 'https://nextonton.inotai.net/');
    expect(screen.getByText(/収益は一切発生しません/)).toBeInTheDocument();
    expect(screen.getByText(/セキュリティ上のトラブルについても一切責任を負いません/)).toBeInTheDocument();
  });

  it('同じブラウザで作成したイベント履歴から回答ボードと管理画面へ移動できる', () => {
    localStorage.setItem('kurukuru:created-events', JSON.stringify([{
      eventId: 'event-history', title: '履歴にある定例会', createdAt: '2026-11-05T12:00:00.000Z',
      participantUrl: 'https://example.test/#/events/event-history',
      organizerUrl: 'https://example.test/#/events/event-history/admin',
    }]));
    render(<HashRouter><App /></HashRouter>);

    const history = screen.getByRole('region', { name: 'このブラウザで作成したイベント' });
    expect(history).toHaveTextContent('履歴にある定例会');
    expect(screen.getByRole('link', { name: '回答ボード' }))
      .toHaveAttribute('href', 'https://example.test/#/events/event-history');
    expect(screen.getByRole('link', { name: '候補日時管理' }))
      .toHaveAttribute('href', 'https://example.test/#/events/event-history/admin');
  });

  it('参加者用イベントURLのルートを持つ', () => {
    window.location.hash = '#/events/11111111-1111-4111-8111-111111111111';
    render(<HashRouter><App /></HashRouter>);
    expect(screen.getByText('イベントを読み込んでいます…')).toBeInTheDocument();
  });

  it('主催者用イベントURLのルートを持つ', async () => {
    window.location.hash = '#/events/11111111-1111-4111-8111-111111111111/admin';
    render(<HashRouter><App /></HashRouter>);
    expect(await screen.findByRole('heading', { name: 'イベントを管理する' })).toBeInTheDocument();
  });

  it('メール確認URLのルートを持つ', () => {
    window.location.hash = '#/email-verifications/secret-verification-token';
    render(<HashRouter><App /></HashRouter>);
    expect(screen.getByText('メールアドレスを確認しています…')).toBeInTheDocument();
  });
});
