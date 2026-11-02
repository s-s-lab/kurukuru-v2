import { describe, expect, it } from 'vitest';

import type { PublicEvent } from '../../../functions/events/service';
import {
  buildGridModel,
  countAvailabilityBySlot,
  createResponseDraft,
  createResponseRequest,
  readStoredEdit,
  responseForStoredEdit,
  storageKey,
  writeStoredEdit,
} from './response-model';

const eventId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const slotA = '33333333-3333-4333-8333-333333333333';
const slotB = '44444444-4444-4444-8444-444444444444';

const event: PublicEvent = {
  id: eventId,
  title: '11月の定例',
  description: '日程を決めます。',
  status: 'open',
  finalization: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [
    { id: slotB, date: '2026-11-11', slotIndex: 20 },
    { id: slotA, date: '2026-11-10', slotIndex: 18 },
  ],
  responses: [{
    id: responseId,
    displayName: '山田',
    comment: '参加します',
    createdAt: '2026-11-01T01:00:00.000Z',
    updatedAt: '2026-11-01T01:00:00.000Z',
    availability: [
      { candidateSlotId: slotA, mark: 'best' },
      { candidateSlotId: slotB, mark: 'ng' },
    ],
  }],
};

describe('participant response model', () => {
  it('initializes every candidate slot as ng and serializes one sorted value per slot', () => {
    const draft = createResponseDraft(event);
    expect(draft.availability).toEqual({ [slotA]: 'ng', [slotB]: 'ng' });

    expect(createResponseRequest(event, {
      ...draft,
      displayName: ' 山田 ',
      comment: ' よろしく ',
    })).toEqual({
      displayName: '山田',
      comment: 'よろしく',
      availability: [
        { candidateSlotId: slotA, mark: 'ng' },
        { candidateSlotId: slotB, mark: 'ng' },
      ],
    });
  });

  it('prefills a locally-owned public response and rejects malformed stored edit data', () => {
    expect(responseForStoredEdit(event, { responseId, editToken: 'a'.repeat(43) })).toEqual({
      displayName: '山田',
      comment: '参加します',
      availability: { [slotA]: 'best', [slotB]: 'ng' },
    });
    expect(responseForStoredEdit(event, {
      responseId: '55555555-5555-4555-8555-555555555555',
      editToken: 'b'.repeat(43),
    })).toBeNull();
    expect(readStoredEdit('{"responseId":"bad"}')).toBeNull();
    expect(readStoredEdit(null)).toBeNull();
  });

  it('round-trips only the response id and edit token in event-scoped storage data', () => {
    const stored = { responseId, editToken: 'c'.repeat(43) };
    expect(readStoredEdit(writeStoredEdit(stored))).toEqual(stored);
    expect(storageKey(eventId)).toBe(`kurukuru:response-edit:${eventId}`);
  });

  it('builds a sorted sparse date/time grid and counts existing responses by mark', () => {
    expect(buildGridModel(event)).toEqual({
      dates: ['2026-11-10', '2026-11-11'],
      slotIndexes: [18, 19, 20],
      slotIds: {
        '2026-11-10:18': slotA,
        '2026-11-11:20': slotB,
      },
    });
    expect(countAvailabilityBySlot(event.responses, slotA)).toEqual({
      best: 1,
      ok: 0,
      maybe: 0,
      ng: 0,
    });
    expect(countAvailabilityBySlot(event.responses, slotB)).toEqual({
      best: 0,
      ok: 0,
      maybe: 0,
      ng: 1,
    });
  });
});
