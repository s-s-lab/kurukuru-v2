export type AvailabilityMark = 'best' | 'ok' | 'maybe' | 'ng';
export type AvailabilityMap = Record<string, AvailabilityMark>;

export const MARKS = [
  { value: 'best', symbol: '◎', label: '希望' },
  { value: 'ok', symbol: '○', label: '参加可' },
  { value: 'maybe', symbol: '△', label: '未定' },
  { value: 'ng', symbol: '×', label: '不可' },
] as const satisfies ReadonlyArray<{
  value: AvailabilityMark;
  symbol: string;
  label: string;
}>;

export function applyPaint(
  current: AvailabilityMap,
  targetSlotIds: readonly string[],
  mark: AvailabilityMark | null,
  candidateSlotIds: ReadonlySet<string>,
): AvailabilityMap {
  const next = { ...current };

  for (const slotId of targetSlotIds) {
    if (!candidateSlotIds.has(slotId)) {
      continue;
    }

    if (mark === null) {
      delete next[slotId];
    } else {
      next[slotId] = mark;
    }
  }

  return next;
}

