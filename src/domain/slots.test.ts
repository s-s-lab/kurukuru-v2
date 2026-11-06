import { describe, expect, it } from 'vitest';

import {
  assertCandidateSlots,
  formatSlotEnd,
  formatSlotStart,
  isContiguousRange,
  normalizeSlotIndexes,
} from './slots';

describe('30分候補枠', () => {
  it('06:00開始から翌06:00終了までを正しく表示する', () => {
    expect(formatSlotStart(12)).toBe('06:00');
    expect(formatSlotStart(47)).toBe('23:30');
    expect(formatSlotEnd(47)).toBe('24:00');
    expect(formatSlotStart(48)).toBe('00:00');
    expect(formatSlotStart(59)).toBe('05:30');
    expect(formatSlotEnd(59)).toBe('06:00');
  });

  it('重複した候補枠を除去して時刻順に並べる', () => {
    expect(normalizeSlotIndexes([30, 12, 30, 13])).toEqual([12, 13, 30]);
  });

  it('06:00より前と翌06:00以降の候補枠を拒否する', () => {
    expect(() => assertCandidateSlots([11])).toThrow('06:00〜翌06:00');
    expect(() => assertCandidateSlots([60])).toThrow('06:00〜翌06:00');
  });

  it('連続枠だけを確定範囲として扱う', () => {
    expect(isContiguousRange([26, 27, 28])).toBe(true);
    expect(isContiguousRange([26, 28])).toBe(false);
    expect(isContiguousRange([])).toBe(false);
  });
});

