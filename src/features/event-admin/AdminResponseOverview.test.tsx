import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AdminEvent } from '../../../functions/admin/service';
import { AdminResponseOverview } from './AdminResponseOverview';

const slotA = '11111111-1111-4111-8111-111111111111';
const slotB = '22222222-2222-4222-8222-222222222222';
const event: AdminEvent = {
  id: '33333333-3333-4333-8333-333333333333', title: '11月の定例', description: '',
  organizerEmail: 'owner@example.com', organizerEmailVerified: true,
  notifyOnResponse: true, status: 'open',
  finalization: { date: '2026-11-10', startSlot: 18, endSlot: 20 }, version: 1,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [
    { id: slotA, date: '2026-11-10', slotIndex: 18 },
    { id: slotB, date: '2026-11-10', slotIndex: 20 },
  ],
  responses: [
    {
      id: '44444444-4444-4444-8444-444444444444', displayName: '山田 太郎',
      comment: '午前中なら参加できます。',
      createdAt: '2026-11-01T01:00:00.000Z', updatedAt: '2026-11-01T02:00:00.000Z',
      availability: [
        { candidateSlotId: slotA, mark: 'best' },
        { candidateSlotId: slotB, mark: 'ng' },
      ],
    },
    {
      id: '55555555-5555-4555-8555-555555555555', displayName: '佐藤 花子', comment: '',
      createdAt: '2026-11-01T01:30:00.000Z', updatedAt: '2026-11-01T02:30:00.000Z',
      availability: [
        { candidateSlotId: slotA, mark: 'ok' },
        { candidateSlotId: slotB, mark: 'maybe' },
      ],
    },
  ],
};

describe('organizer response overview', () => {
  afterEach(cleanup);

  it('shows candidate/finalization context, four literal counts, and responses', () => {
    render(<AdminResponseOverview event={event} />);

    expect(screen.getAllByText('11月10日（火）')).toHaveLength(2);
    expect(screen.getByText('11月10日（火） 09:00〜10:00')).toBeInTheDocument();
    const table = screen.getByRole('table', { name: '回答状況の時間表' });
    expect(within(table).getByLabelText(/09:00〜09:30.*希望1.*参加可1.*未定0.*不可0/))
      .toHaveTextContent('◎1○1△0×0');
    expect(within(table).getByLabelText(/10:00〜10:30.*希望0.*参加可0.*未定1.*不可1/))
      .toHaveTextContent('◎0○0△1×1');
    expect(within(table).getByLabelText('11月10日（火） 09:30〜10:00 候補なし'))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '回答者 2名' })).toBeInTheDocument();
    expect(screen.getByText('山田 太郎')).toBeInTheDocument();
    expect(screen.getByText('午前中なら参加できます。')).toBeInTheDocument();
    expect(screen.getByText('佐藤 花子')).toBeInTheDocument();
    expect(screen.getAllByText(/^更新 /)).toHaveLength(2);
  });

  it('shows an unfinalized zero-response state with a sharing prompt', () => {
    render(<AdminResponseOverview event={{ ...event, finalization: null, responses: [] }} />);
    expect(screen.getByText('開催日時は未確定です')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '回答者 0名' })).toBeInTheDocument();
    expect(screen.getByText('まだ回答はありません。参加者用URLを共有して回答を集めましょう。'))
      .toBeInTheDocument();
  });
});
