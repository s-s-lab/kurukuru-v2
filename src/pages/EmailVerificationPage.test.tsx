import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailVerificationPage } from './EmailVerificationPage';

afterEach(cleanup);

function renderPage(fetcher: typeof fetch, token = 'secret-verification-token') {
  return render(<MemoryRouter initialEntries={[`/email-verifications/${token}`]}>
    <Routes><Route path="/email-verifications/:token" element={
      <EmailVerificationPage apiBaseUrl="/api/v1" fetcher={fetcher} />
    } /></Routes>
  </MemoryRouter>);
}

describe('EmailVerificationPage', () => {
  it('確認中から完了表示へ遷移しトークンを画面に出さない', async () => {
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn<typeof fetch>(() => new Promise((done) => { resolve = done; }));
    const view = renderPage(fetcher);
    expect(screen.getByText('メールアドレスを確認しています…')).toBeInTheDocument();
    expect(view.container.textContent).not.toContain('secret-verification-token');
    resolve(Response.json({
      eventId: '11111111-1111-4111-8111-111111111111', status: 'verified',
    }));
    expect(await screen.findByRole('heading', { name: 'メールアドレスを確認しました' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '主催者画面を開く' })).toHaveAttribute(
      'href', '#/events/11111111-1111-4111-8111-111111111111/admin',
    );
  });

  it('期限切れ・無効リンクを再試行しない固定案内にする', async () => {
    const fetcher: typeof fetch = async () => Response.json({
      code: 'EMAIL_VERIFICATION_NOT_FOUND', message: '確認リンクが無効か、有効期限が切れています。', requestId: 'request-1',
    }, { status: 404 });
    renderPage(fetcher);
    expect(await screen.findByRole('heading', { name: 'この確認リンクは利用できません' })).toBeInTheDocument();
    expect(screen.getByText(/主催者画面から確認メールを再送/)).toBeInTheDocument();
  });

  it('一時的な失敗では再読み込みを案内する', async () => {
    const fetcher: typeof fetch = async () => { throw new Error('network private'); };
    renderPage(fetcher);
    expect(await screen.findByRole('heading', { name: '確認を完了できませんでした' })).toBeInTheDocument();
    expect(screen.getByText(/時間をおいてページを再読み込み/)).toBeInTheDocument();
  });
});
