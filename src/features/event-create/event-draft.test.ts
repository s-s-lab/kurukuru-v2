import { describe, expect, it } from 'vitest';

import {
  buildEventUrls,
  createEmptyEventDraft,
  removeCandidateDay,
  toCreateEventRequest,
  toggleCandidateSlot,
  validateBasicInformation,
  validateCandidateDays,
  type EventDraft,
} from './event-draft';

const draft: EventDraft = {
  title: '打ち合わせ',
  description: '',
  organizerEmail: 'organizer@example.com',
  adminPassword: 'password',
  notifyOnResponse: true,
  candidateDays: [{ date: '2026-11-10', slotIndexes: [18] }],
};

describe('event creation draft', () => {
  it('starts with empty fields, enabled notifications, and independent candidate arrays', () => {
    const first = createEmptyEventDraft();
    expect(first).toEqual({
      title: '', description: '', organizerEmail: '', adminPassword: '',
      notifyOnResponse: true, candidateDays: [],
    });
    first.candidateDays.push({ date: '2026-11-10', slotIndexes: [18] });
    expect(createEmptyEventDraft().candidateDays).toEqual([]);
  });

  it('accepts valid basic information', () => {
    expect(validateBasicInformation(draft)).toEqual({});
  });

  it('rejects whitespace-only titles', () => {
    expect(validateBasicInformation({ ...draft, title: '   ' })).toEqual({
      title: 'イベント名を入力してください。',
    });
  });

  it('rejects malformed email addresses', () => {
    expect(validateBasicInformation({ ...draft, organizerEmail: 'invalid' })).toEqual({
      organizerEmail: '有効なメールアドレスを入力してください。',
    });
  });

  it('rejects passwords shorter than eight characters without trimming them', () => {
    expect(validateBasicInformation({ ...draft, adminPassword: '1234567' })).toEqual({
      adminPassword: '管理用パスワードは8文字以上128文字以下で入力してください。',
    });
    expect(validateBasicInformation({ ...draft, adminPassword: ' pass   ' })).toEqual({});
  });

  it.each([
    ['title', 'a'.repeat(101)],
    ['description', 'a'.repeat(2001)],
    ['organizerEmail', `${'a'.repeat(250)}@example.com`],
    ['adminPassword', 'a'.repeat(129)],
  ])('rejects %s exceeding the API limit', (field, value) => {
    expect(validateBasicInformation({ ...draft, [field]: value })[field]).toBeTruthy();
  });

  it('requires at least one candidate day', () => {
    expect(validateCandidateDays([]).candidateDays).toBeTruthy();
  });

  it('rejects duplicate candidate dates', () => {
    expect(validateCandidateDays([
      { date: '2026-11-10', slotIndexes: [18] },
      { date: '2026-11-10', slotIndexes: [19] },
    ]).candidateDays).toBeTruthy();
  });

  it('rejects a candidate day without a selected slot', () => {
    expect(validateCandidateDays([{ date: '2026-11-10', slotIndexes: [] }]).candidateDays)
      .toBeTruthy();
  });

  it.each(['not-a-date', '2026-02-30'])('rejects invalid date %s', (date) => {
    expect(validateCandidateDays([{ date, slotIndexes: [18] }]).candidateDays).toBeTruthy();
  });

  it.each([11, 48, 18.5])('rejects invalid slot index %s', (slotIndex) => {
    expect(validateCandidateDays([{ date: '2026-11-10', slotIndexes: [slotIndex] }])
      .candidateDays).toBeTruthy();
  });

  it('accepts valid candidate days', () => {
    expect(validateCandidateDays(draft.candidateDays)).toEqual({});
  });

  it('rejects more than twenty candidate days', () => {
    const days = Array.from({ length: 21 }, (_, index) => ({
      date: `2026-11-${String(index + 1).padStart(2, '0')}`, slotIndexes: [18],
    }));
    expect(validateCandidateDays(days).candidateDays).toBeTruthy();
  });

  it('adds a candidate date and toggles slots immutably in time order', () => {
    const days = [{ date: '2026-11-10', slotIndexes: [] as number[] }];
    expect(toggleCandidateSlot(days, '2026-11-10', 18)).toEqual([
      { date: '2026-11-10', slotIndexes: [18] },
    ]);
    expect(days).toEqual([{ date: '2026-11-10', slotIndexes: [] }]);
    const selected = [{ date: '2026-11-10', slotIndexes: [19] }];
    expect(toggleCandidateSlot(selected, '2026-11-10', 18)).toEqual([
      { date: '2026-11-10', slotIndexes: [18, 19] },
    ]);
    expect(toggleCandidateSlot(selected, '2026-11-10', 19)).toEqual([
      { date: '2026-11-10', slotIndexes: [] },
    ]);
    expect(selected).toEqual([{ date: '2026-11-10', slotIndexes: [19] }]);
    expect(toggleCandidateSlot([], '2026-11-12', 24)).toEqual([
      { date: '2026-11-12', slotIndexes: [24] },
    ]);
  });

  it('rejects an invalid slot even when toggling a new day', () => {
    expect(() => toggleCandidateSlot([], '2026-11-10', 48)).toThrow(RangeError);
  });

  it('removes only the specified candidate day without changing the input', () => {
    const days = [
      { date: '2026-11-10', slotIndexes: [18] },
      { date: '2026-11-12', slotIndexes: [24] },
    ];
    expect(removeCandidateDay(days, '2026-11-10')).toEqual([
      { date: '2026-11-12', slotIndexes: [24] },
    ]);
    expect(days).toHaveLength(2);
    expect(removeCandidateDay(days, '2026-11-14')).toEqual(days);
  });

  it('produces exactly the approved request fields with normalized date and slot order', () => {
    const unsortedDraft: EventDraft = {
      title: '  打ち合わせ  ', description: '  詳細  ',
      organizerEmail: ' ORGANIZER@example.com ', adminPassword: ' password ',
      notifyOnResponse: false,
      candidateDays: [
        { date: '2026-11-12', slotIndexes: [24] },
        { date: '2026-11-10', slotIndexes: [19, 18, 19] },
      ],
    };
    expect(toCreateEventRequest(unsortedDraft)).toEqual({
      title: '打ち合わせ', description: '詳細', organizerEmail: 'organizer@example.com',
      adminPassword: ' password ', notifyOnResponse: false,
      candidateSlots: [
        { date: '2026-11-10', slotIndexes: [18, 19] },
        { date: '2026-11-12', slotIndexes: [24] },
      ],
    });
    expect(unsortedDraft.candidateDays).toEqual([
      { date: '2026-11-12', slotIndexes: [24] },
      { date: '2026-11-10', slotIndexes: [19, 18, 19] },
    ]);
  });

  it.each(['/', '/kurukuru/'])('builds absolute HashRouter URLs at deployment path %s', (pathname) => {
    const urls = buildEventUrls('event-123', { origin: 'https://example.com', pathname });
    expect(urls).toEqual({
      participantUrl: `https://example.com${pathname}#/events/event-123`,
      organizerUrl: `https://example.com${pathname}#/events/event-123/admin`,
    });
  });
});
