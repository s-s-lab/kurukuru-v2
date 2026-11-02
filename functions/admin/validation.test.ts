import { describe, expect, it } from 'vitest';

import {
  adminCandidateSlotsSchema,
  adminFinalizationSchema,
} from './validation';

describe('admin lifecycle validation', () => {
  it('normalizes candidate days and indexes into deterministic order', () => {
    expect(adminCandidateSlotsSchema.parse({
      candidateSlots: [
        { date: '2026-11-12', slotIndexes: [20, 18, 19] },
        { date: '2026-11-10', slotIndexes: [13, 12] },
      ],
    })).toEqual({
      candidateSlots: [
        { date: '2026-11-10', slotIndexes: [12, 13] },
        { date: '2026-11-12', slotIndexes: [18, 19, 20] },
      ],
    });
  });

  it.each([
    [{ candidateSlots: [] }, 'empty candidate list'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [] }] }, 'empty indexes'],
    [{ candidateSlots: [{ date: '2026-02-30', slotIndexes: [12] }] }, 'invalid date'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [11] }] }, 'index below range'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [48] }] }, 'index above range'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [12, 12] }] }, 'duplicate index'],
    [{ candidateSlots: [
      { date: '2026-11-10', slotIndexes: [12] },
      { date: '2026-11-10', slotIndexes: [13] },
    ] }, 'duplicate date'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [12], extra: true }] }, 'unknown day key'],
    [{ candidateSlots: [{ date: '2026-11-10', slotIndexes: [12] }], extra: true }, 'unknown root key'],
  ])('rejects invalid candidate replacement: %s (%s)', (input, label) => {
    expect(adminCandidateSlotsSchema.safeParse(input).success, label).toBe(false);
  });

  it('accepts an exclusive finalization interval at both slot boundaries', () => {
    expect(adminFinalizationSchema.parse({
      date: '2026-11-10',
      startSlot: 12,
      endSlot: 48,
    })).toEqual({ date: '2026-11-10', startSlot: 12, endSlot: 48 });
  });

  it.each([
    [{ date: '2026-02-30', startSlot: 12, endSlot: 13 }, 'invalid date'],
    [{ date: '2026-11-10', startSlot: 11, endSlot: 13 }, 'start below range'],
    [{ date: '2026-11-10', startSlot: 48, endSlot: 48 }, 'start above range'],
    [{ date: '2026-11-10', startSlot: 12, endSlot: 12 }, 'empty interval'],
    [{ date: '2026-11-10', startSlot: 20, endSlot: 19 }, 'reversed interval'],
    [{ date: '2026-11-10', startSlot: 12.5, endSlot: 14 }, 'fractional index'],
    [{ date: '2026-11-10', startSlot: 12, endSlot: 49 }, 'end above range'],
    [{ date: '2026-11-10', startSlot: 12, endSlot: 13, extra: true }, 'unknown key'],
  ])('rejects invalid finalization: %s (%s)', (input, label) => {
    expect(adminFinalizationSchema.safeParse(input).success, label).toBe(false);
  });
});
