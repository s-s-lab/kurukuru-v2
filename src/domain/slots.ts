const MIN_SLOT_INDEX = 12;
const MAX_SLOT_INDEX = 47;

function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function formatSlotStart(slotIndex: number): string {
  assertCandidateSlots([slotIndex]);
  return formatMinutes(slotIndex * 30);
}

export function formatSlotEnd(slotIndex: number): string {
  assertCandidateSlots([slotIndex]);
  return formatMinutes((slotIndex + 1) * 30);
}

export function normalizeSlotIndexes(slotIndexes: readonly number[]): number[] {
  const normalized = [...new Set(slotIndexes)].sort((left, right) => left - right);
  assertCandidateSlots(normalized);
  return normalized;
}

export function assertCandidateSlots(slotIndexes: readonly number[]): void {
  const invalid = slotIndexes.find(
    (slotIndex) =>
      !Number.isInteger(slotIndex) || slotIndex < MIN_SLOT_INDEX || slotIndex > MAX_SLOT_INDEX,
  );

  if (invalid !== undefined) {
    throw new RangeError('候補時間は06:00〜24:00の30分単位で指定してください。');
  }
}

export function isContiguousRange(slotIndexes: readonly number[]): boolean {
  if (slotIndexes.length === 0) {
    return false;
  }

  const normalized = normalizeSlotIndexes(slotIndexes);
  return normalized.every(
    (slotIndex, index) => index === 0 || slotIndex === normalized[index - 1] + 1,
  );
}

