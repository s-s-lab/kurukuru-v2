import { cleanup, render, screen } from '@testing-library/react';
import { HashRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './App';

describe('Kurukuruの入口', () => {
  beforeEach(() => {
    window.location.hash = '#/';
    sessionStorage.clear();
  });
  afterEach(cleanup);
  it('サービスの価値とイベント作成導線を表示する', () => {
    render(
      <HashRouter>
        <App />
      </HashRouter>,
    );

    expect(screen.getByRole('heading', { name: '候補時間を選んで、URLを共有。' })).toBeInTheDocument();
    expect(screen.getByText(/ひとつの公開ボードで比べられます/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '回答ボードの表示例' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '日程調整を作成' })).toHaveAttribute(
      'href',
      '#/events/new',
    );
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
