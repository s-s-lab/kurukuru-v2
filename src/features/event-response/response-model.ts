import { z } from 'zod';

import type {
  AvailabilityMark,
  PublicEvent,
  PublicResponse,
} from '../../../functions/events/service';
import type { AvailabilityMap } from '../../domain/availability';

export type ResponseDraft = {
  displayName: string;
  comment: string;
  availability: AvailabilityMap;
};

export type StoredResponseEdit = {
  responseId: string;
  editToken: string;
};

export type AvailabilityCounts = Record<AvailabilityMark, number>;

const storedResponseEditSchema = z.object({
  responseId: z.uuid(),
  editToken: z.string().min(16).max(512),
}).strict();

export function storageKey(eventId: string): string {
  return `kurukuru:response-edit:${eventId}`;
}

export function readStoredEdit(raw: string | null): StoredResponseEdit | null {
  if (!raw) return null;
  try {
    const parsed = storedResponseEditSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStoredEdit(stored: StoredResponseEdit): string {
  return JSON.stringify(storedResponseEditSchema.parse(stored));
}

export function createResponseDraft(event: PublicEvent): ResponseDraft {
  return {
    displayName: '',
    comment: '',
    availability: Object.fromEntries(
      event.candidateSlots.map(({ id }) => [id, 'ng' as const]),
    ),
  };
}

export function responseForStoredEdit(
  event: PublicEvent,
  stored: StoredResponseEdit,
): ResponseDraft | null {
  return responseForEdit(event, stored.responseId);
}

export function responseForEdit(event: PublicEvent, responseId: string): ResponseDraft | null {
  const response = event.responses.find(({ id }) => id === responseId);
  if (!response) return null;

  const availability = Object.fromEntries(
    event.candidateSlots.map(({ id }) => [id, 'ng' as const]),
  ) as AvailabilityMap;
  for (const answer of response.availability) {
    if (answer.candidateSlotId in availability) {
      availability[answer.candidateSlotId] = answer.mark;
    }
  }

  return {
    displayName: response.displayName,
    comment: response.comment,
    availability,
  };
}

export function createResponseRequest(event: PublicEvent, draft: ResponseDraft) {
  return {
    displayName: draft.displayName.trim(),
    comment: draft.comment.trim(),
    availability: [...event.candidateSlots]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id }) => ({
        candidateSlotId: id,
        mark: draft.availability[id] ?? 'ng' as AvailabilityMark,
      })),
  };
}

export function buildGridModel(event: PublicEvent) {
  const dates = [...new Set(event.candidateSlots.map(({ date }) => date))].sort();
  const indexes = event.candidateSlots.map(({ slotIndex }) => slotIndex);
  const minimum = indexes.length ? Math.min(...indexes) : 12;
  const maximum = indexes.length ? Math.max(...indexes) : 12;
  const slotIndexes = indexes.length
    ? Array.from({ length: maximum - minimum + 1 }, (_, index) => minimum + index)
    : [];
  const slotIds = Object.fromEntries(
    event.candidateSlots.map(({ id, date, slotIndex }) => [`${date}:${slotIndex}`, id]),
  );
  return { dates, slotIndexes, slotIds };
}

export function countAvailabilityBySlot(
  responses: readonly PublicResponse[],
  candidateSlotId: string,
): AvailabilityCounts {
  const counts: AvailabilityCounts = { best: 0, ok: 0, maybe: 0, ng: 0 };
  for (const response of responses) {
    const answer = response.availability.find((value) => value.candidateSlotId === candidateSlotId);
    if (answer) counts[answer.mark] += 1;
  }
  return counts;
}
