import { describe, expect, it } from 'vitest';

import {
  createCandidateDays,
  createCandidateRequest,
  validateFinalization,
} from './admin-schedule-model';

describe('admin schedule model', () => {
  it('groups API slots into sorted editable candidate days', () => {
    expect(createCandidateDays([
      { id: '33333333-3333-4333-8333-333333333333', date: '2026-11-12', slotIndex: 21 },
      { id: '11111111-1111-4111-8111-111111111111', date: '2026-11-10', slotIndex: 19 },
      { id: '22222222-2222-4222-8222-222222222222', date: '2026-11-10', slotIndex: 18 },
    ])).toEqual([
      { date: '2026-11-10', slotIndexes: [18, 19] },
      { date: '2026-11-12', slotIndexes: [21] },
    ]);
  });

  it('creates a normalized candidate replacement request', () => {
    expect(createCandidateRequest([
      { date: '2026-11-12', slotIndexes: [21, 20] },
      { date: '2026-11-10', slotIndexes: [19, 18] },
    ])).toEqual({ candidateSlots: [
      { date: '2026-11-10', slotIndexes: [18, 19] },
      { date: '2026-11-12', slotIndexes: [20, 21] },
    ] });
  });

  it('accepts only a continuous finalization fully contained in candidate slots', () => {
    const days = [{ date: '2026-11-10', slotIndexes: [18, 19, 21] }];

    expect(validateFinalization(days, {
      date: '2026-11-10', startSlot: 18, endSlot: 20,
    })).toBe('');
    expect(validateFinalization(days, {
      date: '2026-11-10', startSlot: 18, endSlot: 22,
    })).toBe('開始から終了まで連続した候補時間を選択してください。');
    expect(validateFinalization(days, {
      date: '2026-11-11', startSlot: 18, endSlot: 19,
    })).toBe('候補日に含まれる日時を選択してください。');
  });
});
