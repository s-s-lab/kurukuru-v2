import { z } from 'zod';

import { assertCandidateSlots, normalizeSlotIndexes } from '../../domain/slots';

export type CandidateDayDraft = { date: string; slotIndexes: number[] };
export type EventDraft = {
  title: string;
  description: string;
  organizerEmail: string;
  adminPassword: string;
  notifyOnResponse: boolean;
  candidateDays: CandidateDayDraft[];
};
export type FieldErrors = Record<string, string>;
export type BrowserLocation = Pick<Location, 'origin' | 'pathname'>;

export function createEmptyEventDraft(): EventDraft {
  return {
    title: '',
    description: '',
    organizerEmail: '',
    adminPassword: '',
    notifyOnResponse: true,
    candidateDays: [],
  };
}

export function validateBasicInformation(draft: EventDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.title.trim()) {
    errors.title = 'イベント名を入力してください。';
  } else if (draft.title.trim().length > 100) {
    errors.title = 'イベント名は100文字以内で入力してください。';
  }
  if (draft.description.trim().length > 2000) {
    errors.description = '説明は2000文字以内で入力してください。';
  }
  const email = draft.organizerEmail.trim();
  if (email.length > 254 || !z.email().safeParse(email).success) {
    errors.organizerEmail = '有効なメールアドレスを入力してください。';
  }
  if (draft.adminPassword.length < 8 || draft.adminPassword.length > 128) {
    errors.adminPassword = '管理用パスワードは8文字以上128文字以下で入力してください。';
  }
  return errors;
}

export function validateCandidateDays(days: CandidateDayDraft[]): FieldErrors {
  if (days.length === 0 || days.length > 20) {
    return { candidateDays: '候補日は1日以上20日以内で選択してください。' };
  }
  if (new Set(days.map((day) => day.date)).size !== days.length) {
    return { candidateDays: '同じ候補日を重複して指定できません。' };
  }
  for (const day of days) {
    if (!z.iso.date().safeParse(day.date).success) {
      return { candidateDays: '有効な候補日を選択してください。' };
    }
    if (day.slotIndexes.length === 0) {
      return { candidateDays: '各候補日に時間を1つ以上選択してください。' };
    }
    try {
      assertCandidateSlots(day.slotIndexes);
    } catch {
      return { candidateDays: '候補時間は06:00〜24:00の30分単位で指定してください。' };
    }
  }
  return {};
}

export function toggleCandidateSlot(
  days: CandidateDayDraft[],
  date: string,
  slotIndex: number,
): CandidateDayDraft[] {
  assertCandidateSlots([slotIndex]);
  const existing = days.find((day) => day.date === date);
  if (!existing) {
    return [...days, { date, slotIndexes: [slotIndex] }];
  }
  return days.map((day) => day.date === date ? {
    date,
    slotIndexes: normalizeSlotIndexes(day.slotIndexes.includes(slotIndex)
      ? day.slotIndexes.filter((index) => index !== slotIndex)
      : [...day.slotIndexes, slotIndex]),
  } : day);
}

export function removeCandidateDay(days: CandidateDayDraft[], date: string): CandidateDayDraft[] {
  return days.filter((day) => day.date !== date);
}

export function toCreateEventRequest(draft: EventDraft) {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    organizerEmail: draft.organizerEmail.trim().toLowerCase(),
    adminPassword: draft.adminPassword,
    notifyOnResponse: draft.notifyOnResponse,
    candidateSlots: [...draft.candidateDays]
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((day) => ({ date: day.date, slotIndexes: normalizeSlotIndexes(day.slotIndexes) })),
  };
}

export function buildEventUrls(eventId: string, location: BrowserLocation) {
  return {
    participantUrl: `${location.origin}${location.pathname}#/events/${eventId}`,
    organizerUrl: `${location.origin}${location.pathname}#/events/${eventId}/admin`,
  };
}
