import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicEvent } from '../../../functions/events/service';
import { PublicAvailabilityBoard } from './PublicAvailabilityBoard';

const event: PublicEvent = {
  id: '11111111-1111-4111-8111-111111111111', title: '定例会', description: '', status: 'open',
  duration: '1時間程度',
  finalization: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  candidateSlots: [
    { id: 'slot-a', date: '2026-11-10', slotIndex: 18 },
    { id: 'slot-b', date: '2026-11-10', slotIndex: 19 },
    { id: 'slot-c', date: '2026-11-12', slotIndex: 20 },
  ],
  responses: [
    { id: 'r1', displayName: '鈴木', comment: '午前中を希望します', createdAt: '', updatedAt: '', availability: [
      { candidateSlotId: 'slot-a', mark: 'best' }, { candidateSlotId: 'slot-b', mark: 'ok' }, { candidateSlotId: 'slot-c', mark: 'ng' },
    ] },
    { id: 'r2', displayName: '田中', comment: '調整中です', createdAt: '', updatedAt: '', availability: [
      { candidateSlotId: 'slot-a', mark: 'maybe' }, { candidateSlotId: 'slot-b', mark: 'ok' }, { candidateSlotId: 'slot-c', mark: 'best' },
    ] },
  ],
};

describe('公開回答ボード', () => {
  afterEach(cleanup);
  it('候補日ごとの06時から翌06時の表に回答者の回答と非候補時間を表示する', () => {
    render(<PublicAvailabilityBoard event={event} onEditResponse={() => undefined} />);
    const firstDate = screen.getByRole('table', { name: '2026年11月10日のみんなの回答' });
    const secondDate = screen.getByRole('table', { name: '2026年11月12日のみんなの回答' });
    const firstRows = within(firstDate).getAllByRole('row');
    const secondRows = within(secondDate).getAllByRole('row');
    expect(within(firstRows[1]).getByRole('button', { name: '鈴木の回答を編集' })).toBeInTheDocument();
    expect(firstRows[1].querySelectorAll('td')).toHaveLength(48);
    expect(firstRows[1].querySelectorAll('td')[6]).toHaveTextContent('◎');
    expect(firstRows[1].querySelectorAll('td')[7]).toHaveTextContent('○');
    expect(secondRows[2].querySelectorAll('td')[8]).toHaveTextContent('◎');
    expect(firstDate.querySelectorAll('.public-board-slot-blocked').length).toBeGreaterThan(0);
    expect(screen.getByText('午前中を希望します')).toBeInTheDocument();
    expect(screen.getByText('調整中です')).toBeInTheDocument();
    expect(screen.queryByLabelText(/回答人数/)).not.toBeInTheDocument();
  });

  it('回答者名を押すとその回答IDを編集対象として渡す', async () => {
    const onEditResponse = vi.fn();
    const user = userEvent.setup();
    render(<PublicAvailabilityBoard event={event} onEditResponse={onEditResponse} />);
    await user.click(screen.getAllByRole('button', { name: '鈴木の回答を編集' })[0]);
    expect(onEditResponse).toHaveBeenCalledWith('r1');
  });

  it('回答がない場合も候補日時を表示して参加を促す', () => {
    render(<PublicAvailabilityBoard event={{ ...event, responses: [] }} onEditResponse={() => undefined} />);
    expect(screen.getByText('まだ回答はありません。最初の回答を追加してください。')).toBeInTheDocument();
    expect(screen.getAllByRole('table')).toHaveLength(2);
  });
});
