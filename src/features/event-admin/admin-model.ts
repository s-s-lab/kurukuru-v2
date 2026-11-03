import type { AdminEvent } from '../../../functions/admin/service';
import { formatSlotEnd, formatSlotStart } from '../../domain/slots';
import { buildGridModel, countAvailabilityBySlot } from '../event-response/response-model';

const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

export function formatAdminDate(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日（${weekdays[value.getUTCDay()]}）`;
}

export function buildAdminResponseGrid(event: AdminEvent) {
  const { dates, slotIndexes, slotIds } = buildGridModel(event);
  const countsBySlotId = Object.fromEntries(event.candidateSlots.map(({ id }) => [
    id,
    countAvailabilityBySlot(event.responses, id),
  ]));
  return { dates, slotIndexes, slotIds, countsBySlotId };
}

export function formatCandidateDateRange(candidateSlots: AdminEvent['candidateSlots']) {
  const dates = [...new Set(candidateSlots.map(({ date }) => date))].sort();
  if (dates.length === 0) return '候補日はありません';
  if (dates.length === 1) return formatAdminDate(dates[0]);
  return `${formatAdminDate(dates[0])}〜${formatAdminDate(dates[dates.length - 1])}`;
}

export function formatFinalization(finalization: AdminEvent['finalization']) {
  if (!finalization) return '開催日時は未確定です';
  return `${formatAdminDate(finalization.date)} ${formatSlotStart(finalization.startSlot)}〜${formatSlotEnd(finalization.endSlot - 1)}`;
}

export function formatAdminTimestamp(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(new Date(value));
}

export function formatAdminSlotRange(slotIndex: number) {
  return `${formatSlotStart(slotIndex)}〜${formatSlotEnd(slotIndex)}`;
}
