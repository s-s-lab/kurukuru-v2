import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminEmailVerification } from './AdminEmailVerification';

afterEach(cleanup);

describe('AdminEmailVerification', () => {
  it('未確認なら送信操作と通知が始まらない説明を表示する', () => {
    const onSend = vi.fn();
    render(<AdminEmailVerification verified={false} notifyOnResponse
      isSending={false} isDisabled={false} message="" onSend={onSend} />);
    expect(screen.getByText('未確認')).toBeInTheDocument();
    expect(screen.getByText(/確認が完了するまで回答通知は送信されません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '確認メールを送信' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('送信中は多重操作を防ぐ', () => {
    render(<AdminEmailVerification verified={false} notifyOnResponse
      isSending isDisabled={false} message="送信しています" onSend={() => undefined} />);
    expect(screen.getByRole('button', { name: '送信しています…' })).toBeDisabled();
    expect(screen.getByText('送信しています')).toHaveAttribute('aria-live', 'polite');
  });

  it('確認済みなら再送ボタンを表示しない', () => {
    render(<AdminEmailVerification verified notifyOnResponse
      isSending={false} isDisabled={false} message="" onSend={() => undefined} />);
    expect(screen.getByText('確認済み')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('通知設定がオフなら確認後も通知されないことを明示する', () => {
    render(<AdminEmailVerification verified={false} notifyOnResponse={false}
      isSending={false} isDisabled={false} message="" onSend={() => undefined} />);
    expect(screen.getByText(/現在、回答通知はオフです/)).toBeInTheDocument();
  });
});
