import { describe, expect, it } from 'vitest';

import type { AdminEvent } from '../../../functions/admin/service';
import {
  buildAdminResponseGrid,
  formatCandidateDateRange,
  formatFinalization,
} from './admin-model';

const slotA = '11111111-1111-4111-8111-111111111111';
const slotB = '22222222-2222-4222-8222-222222222222';
const slotC = '33333333-3333-4333-8333-333333333333';

const event: AdminEvent = {
  id: '44444444-4444-4444-8444-444444444444',
  title: '定例', description: '', duration: '', organizerEmail: 'owner@example.com',
  organizerEmailVerified: true, notifyOnResponse: true, status: 'open',
  finalization: null, version: 1,
  createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [
    { id: slotC, date: '2026-11-12', slotIndex: 20 },
    { id: slotB, date: '2026-11-10', slotIndex: 20 },
    { id: slotA, date: '2026-11-10', slotIndex: 18 },
  ],
  responses: [
    {
      id: '55555555-5555-4555-8555-555555555555', displayName: '山田', comment: '',
      createdAt: '2026-11-01T01:00:00.000Z', updatedAt: '2026-11-01T01:00:00.000Z',
      availability: [
        { candidateSlotId: slotA, mark: 'best' },
        { candidateSlotId: slotB, mark: 'ok' },
        { candidateSlotId: slotC, mark: 'maybe' },
      ],
    },
    {
      id: '66666666-6666-4666-8666-666666666666', displayName: '佐藤', comment: '',
      createdAt: '2026-11-01T02:00:00.000Z', updatedAt: '2026-11-01T02:00:00.000Z',
      availability: [
        { candidateSlotId: slotA, mark: 'ok' },
        { candidateSlotId: slotB, mark: 'ng' },
        { candidateSlotId: slotC, mark: 'maybe' },
      ],
    },
  ],
};

describe('organizer response display model', () => {
  it('sorts dates, spans sparse slot indexes, and counts each mark literally', () => {
    const grid = buildAdminResponseGrid(event);
    expect(grid.dates).toEqual(['2026-11-10', '2026-11-12']);
    expect(grid.slotIndexes).toEqual([18, 19, 20]);
    expect(grid.slotIds).toEqual({
      '2026-11-10:18': slotA,
      '2026-11-10:20': slotB,
      '2026-11-12:20': slotC,
    });
    expect(grid.countsBySlotId[slotA]).toEqual({ best: 1, ok: 1, maybe: 0, ng: 0 });
    expect(grid.countsBySlotId[slotB]).toEqual({ best: 0, ok: 1, maybe: 0, ng: 1 });
    expect(grid.countsBySlotId[slotC]).toEqual({ best: 0, ok: 0, maybe: 2, ng: 0 });
  });

  it('formats candidate range and the exclusive finalization end', () => {
    expect(formatCandidateDateRange(event.candidateSlots)).toBe('11月10日（火）〜11月12日（木）');
    expect(formatCandidateDateRange([])).toBe('候補日はありません');
    expect(formatFinalization(null)).toBe('開催日時は未確定です');
    expect(formatFinalization({ date: '2026-11-10', startSlot: 18, endSlot: 20 }))
      .toBe('11月10日（火） 09:00〜10:00');
    expect(formatFinalization({ date: '2026-11-10', startSlot: 47, endSlot: 48 }))
      .toBe('11月10日（火） 23:30〜24:00');
  });
});
