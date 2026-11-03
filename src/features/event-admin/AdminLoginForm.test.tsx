import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminLoginForm } from './AdminLoginForm';

describe('organizer admin login form', () => {
  afterEach(cleanup);

  it('submits the password, keeps it out of surrounding text, and clears it', async () => {
    const onSubmit = vi.fn(async () => undefined);
    const user = userEvent.setup();
    render(<AdminLoginForm onSubmit={onSubmit} isSubmitting={false}
      errorMessage="" requestId="" />);

    const password = screen.getByLabelText('管理用パスワード');
    expect(password).toHaveAttribute('type', 'password');
    await user.type(password, 'private-password-sentinel');
    await user.click(screen.getByRole('button', { name: '管理画面を開く' }));

    expect(onSubmit).toHaveBeenCalledWith('private-password-sentinel');
    expect(password).toHaveValue('');
    expect(document.body.textContent).not.toContain('private-password-sentinel');
  });

  it('disables submission while pending and safely displays an error/request ID', () => {
    render(<AdminLoginForm onSubmit={vi.fn()} isSubmitting
      errorMessage="管理画面を開けませんでした。" requestId="request-login-1" />);
    expect(screen.getByRole('button', { name: '確認しています…' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('管理画面を開けませんでした。');
    expect(screen.getByRole('alert')).toHaveTextContent('request-login-1');
  });
});
