import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PublicEvent } from '../../../functions/events/service';
import { PublicAvailabilityBoard } from './PublicAvailabilityBoard';

const event: PublicEvent = {
  id: '11111111-1111-4111-8111-111111111111', title: '定例会', description: '', status: 'open',
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
  it('回答者を行、候補時間を列として全回答とコメントを公開表示する', () => {
    render(<PublicAvailabilityBoard event={event} />);
    const table = screen.getByRole('table', { name: 'みんなの回答' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByRole('rowheader')).toHaveTextContent('鈴木');
    expect(within(rows[1]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['◎', '○', '×']);
    expect(within(rows[2]).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['△', '○', '◎']);
    expect(screen.getByText('午前中を希望します')).toBeInTheDocument();
    expect(screen.getByText('調整中です')).toBeInTheDocument();
    expect(screen.queryByLabelText(/回答人数/)).not.toBeInTheDocument();
  });

  it('回答がない場合も候補日時を表示して参加を促す', () => {
    render(<PublicAvailabilityBoard event={{ ...event, responses: [] }} />);
    expect(screen.getByText('まだ回答はありません。最初の回答を追加してください。')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'みんなの回答' })).toBeInTheDocument();
  });
});
