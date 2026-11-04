import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateDateCalendar } from './CandidateDateCalendar';

describe('候補日カレンダー', () => {
  afterEach(cleanup);

  it('20日の上限到達後も未選択日へ矢印移動でき、追加操作だけを無効にする', async () => {
    const user = userEvent.setup();
    const onToggleDate = vi.fn();
    const days = [
      ...Array.from({ length: 16 }, (_, index) => ({
        date: `2026-11-${String(index * 2 + 1).padStart(2, '0')}`,
        slotIndexes: [],
      })),
      ...[2, 4, 6, 8].map((day) => ({ date: `2026-12-${String(day).padStart(2, '0')}`, slotIndexes: [] })),
    ];
    render(<CandidateDateCalendar days={days} currentDate="2026-11-01" onToggleDate={onToggleDate} />);

    const selected = screen.getByRole('button', { name: '2026年11月1日を候補日から削除' });
    const blocked = screen.getByRole('button', { name: '2026年11月2日を候補日に追加' });
    selected.focus();
    await user.keyboard('{ArrowRight}');
    expect(blocked).toHaveFocus();
    expect(blocked).toHaveAttribute('tabindex', '0');
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).not.toBeDisabled();
    await user.click(blocked);
    expect(onToggleDate).not.toHaveBeenCalled();
  });
});
