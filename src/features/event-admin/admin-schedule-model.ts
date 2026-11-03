import type { PublicCandidateSlot } from '../../../functions/events/service';
import { normalizeSlotIndexes } from '../../domain/slots';
import type { AdminFinalizationRequest } from '../../../functions/admin/service';
import type { CandidateDayDraft } from '../event-create/event-draft';

export function createCandidateDays(slots: PublicCandidateSlot[]): CandidateDayDraft[] {
  const grouped = new Map<string, number[]>();
  for (const slot of slots) {
    grouped.set(slot.date, [...(grouped.get(slot.date) ?? []), slot.slotIndex]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, slotIndexes]) => ({ date, slotIndexes: normalizeSlotIndexes(slotIndexes) }));
}

export function createCandidateRequest(days: CandidateDayDraft[]) {
  return {
    candidateSlots: [...days]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map(({ date, slotIndexes }) => ({ date, slotIndexes: normalizeSlotIndexes(slotIndexes) })),
  };
}

export function validateFinalization(
  days: CandidateDayDraft[],
  request: AdminFinalizationRequest,
): string {
  const day = days.find(({ date }) => date === request.date);
  if (!day || request.startSlot < 12 || request.endSlot > 48 || request.endSlot <= request.startSlot) {
    return '候補日に含まれる日時を選択してください。';
  }
  const slots = new Set(day.slotIndexes);
  for (let slot = request.startSlot; slot < request.endSlot; slot += 1) {
    if (!slots.has(slot)) return '開始から終了まで連続した候補時間を選択してください。';
  }
  return '';
}
