export const DAY_SLOT_INDEXES = Array.from({ length: 48 }, (_, index) => index + 12);

export function formatTimelineHeader(slotIndex: number) {
  const hour = Math.floor(slotIndex / 2) % 24;
  return slotIndex % 2 === 0 ? String(hour).padStart(2, '0') : '';
}

export function uniqueCandidateDates(slots: Array<{ date: string }>) {
  return [...new Set(slots.map(({ date }) => date))].sort();
}
