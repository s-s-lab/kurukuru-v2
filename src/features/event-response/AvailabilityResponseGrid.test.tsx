import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AvailabilityMark, PublicEvent } from '../../../functions/events/service';
import { createResponseDraft } from './response-model';
import { AvailabilityResponseGrid } from './AvailabilityResponseGrid';
import { ParticipantResponseForm } from './ParticipantResponseForm';

const slotA = '33333333-3333-4333-8333-333333333333';
const slotB = '44444444-4444-4444-8444-444444444444';
const event: PublicEvent = {
  id: '11111111-1111-4111-8111-111111111111',
  title: '11月のプロジェクト定例',
  description: 'みなさんの都合のよい日時を教えてください。',
  status: 'open',
  finalization: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [
    { id: slotA, date: '2026-11-10', slotIndex: 18 },
    { id: slotB, date: '2026-11-10', slotIndex: 20 },
  ],
  responses: [{
    id: '22222222-2222-4222-8222-222222222222',
    displayName: '既存参加者',
    comment: '',
    createdAt: '2026-11-01T01:00:00.000Z',
    updatedAt: '2026-11-01T01:00:00.000Z',
    availability: [
      { candidateSlotId: slotA, mark: 'best' },
      { candidateSlotId: slotB, mark: 'ng' },
    ],
  }],
};

function GridHarness() {
  const [availability, setAvailability] = useState(createResponseDraft(event).availability);
  const [mark, setMark] = useState<AvailabilityMark>('best');
  return <AvailabilityResponseGrid event={event} availability={availability}
    selectedMark={mark} onSelectedMarkChange={setMark}
    onPaint={(slotIds, nextMark) => setAvailability((current) => ({
      ...current,
      ...Object.fromEntries(slotIds.map((slotId) => [slotId, nextMark])),
    }))} />;
}

describe('participant availability UI', () => {
  afterEach(cleanup);

  it('shows only candidate cells as answerable and paints a chosen mark', async () => {
    const user = userEvent.setup();
    render(<GridHarness />);
    const table = screen.getByRole('table', { name: '回答する時間表' });
    expect(within(table).getAllByRole('button')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: / 09:30〜10:00 / })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '希望' }));
    const cell = screen.getByRole('button', { name: /11月10日（火） 09:00〜09:30 不可/ });
    await user.click(cell);
    expect(screen.getByRole('button', { name: /11月10日（火） 09:00〜09:30 希望/ })).toHaveTextContent('◎');
  });

  it('switches between paint and move modes without showing aggregate response counts', async () => {
    const user = userEvent.setup();
    render(<GridHarness />);
    const region = screen.getByRole('region', { name: '回答時間表' });
    expect(region).toHaveClass('is-painting');
    await user.click(screen.getByRole('button', { name: '移動（スクロール）' }));
    expect(region).not.toHaveClass('is-painting');
    expect(screen.queryByLabelText(/回答人数/)).not.toBeInTheDocument();
  });

  it('opens response entry in a modal and disables the action for a closed event', async () => {
    const user = userEvent.setup();
    const draft = createResponseDraft(event);
    const { rerender } = render(<ParticipantResponseForm event={event} draft={draft}
      selectedMark="best" onSelectedMarkChange={vi.fn()} onDraftChange={vi.fn()}
      onPaint={vi.fn()} onSubmit={vi.fn()} onShare={vi.fn()} isSubmitting={false}
      ownsResponse={false} saveMessage="" />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回答を追加' }));
    expect(screen.getByRole('dialog', { name: '回答を追加' })).toBeInTheDocument();
    expect(screen.getByLabelText(/お名前/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(<ParticipantResponseForm event={{ ...event, status: 'closed' }} draft={draft}
      selectedMark="best" onSelectedMarkChange={vi.fn()} onDraftChange={vi.fn()}
      onPaint={vi.fn()} onSubmit={vi.fn()} onShare={vi.fn()} isSubmitting={false}
      ownsResponse={false} saveMessage="" />);
    expect(screen.getByText('回答受付は終了しています')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回答を追加' })).toBeDisabled();
  });
});
