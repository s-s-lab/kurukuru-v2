import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminEventStatusControl } from './AdminEventStatusControl';

describe('organizer response status control', () => {
  afterEach(cleanup);

  it('describes and invokes the reversible close action', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<AdminEventStatusControl status="open" onClose={onClose} onReopen={vi.fn()}
      isChanging={false} message="" />);
    expect(screen.getByText('停止後も、いつでも回答受付を再開できます。')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回答受付を停止' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('describes reopen and exposes its pending result as a live region', () => {
    render(<AdminEventStatusControl status="closed" onClose={vi.fn()} onReopen={vi.fn()}
      isChanging message="受付状態を変更できませんでした。" />);
    expect(screen.getByText('再開すると、参加者が回答を保存・更新できるようになります。'))
      .toBeInTheDocument();
    expect(screen.getByRole('button', { name: '変更しています…' })).toBeDisabled();
    expect(screen.getByText('受付状態を変更できませんでした。')).toHaveAttribute('aria-live', 'polite');
  });
});
