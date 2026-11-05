import { beforeEach, describe, expect, it } from 'vitest';

import { readCreatedEventHistory, saveCreatedEventHistory } from './event-history';

describe('同一ブラウザの作成イベント履歴', () => {
  beforeEach(() => localStorage.clear());

  it('新しいイベントを先頭に保存し同じイベントは重複させない', () => {
    saveCreatedEventHistory({
      eventId: 'event-1', title: '定例会', createdAt: '2026-11-05T10:00:00.000Z',
      participantUrl: 'https://example.test/#/events/event-1',
      organizerUrl: 'https://example.test/#/events/event-1/admin',
    });
    saveCreatedEventHistory({
      eventId: 'event-2', title: '相談会', createdAt: '2026-11-05T11:00:00.000Z',
      participantUrl: 'https://example.test/#/events/event-2',
      organizerUrl: 'https://example.test/#/events/event-2/admin',
    });
    saveCreatedEventHistory({
      eventId: 'event-1', title: '定例会（更新）', createdAt: '2026-11-05T12:00:00.000Z',
      participantUrl: 'https://example.test/#/events/event-1',
      organizerUrl: 'https://example.test/#/events/event-1/admin',
    });

    expect(readCreatedEventHistory()).toEqual([
      expect.objectContaining({ eventId: 'event-1', title: '定例会（更新）' }),
      expect.objectContaining({ eventId: 'event-2', title: '相談会' }),
    ]);
  });

  it('履歴を直近10件に制限し壊れた保存値は空として扱う', () => {
    for (let index = 0; index < 12; index += 1) {
      saveCreatedEventHistory({
        eventId: `event-${index}`, title: `イベント${index}`,
        createdAt: `2026-11-05T${String(index).padStart(2, '0')}:00:00.000Z`,
        participantUrl: `https://example.test/#/events/event-${index}`,
        organizerUrl: `https://example.test/#/events/event-${index}/admin`,
      });
    }
    expect(readCreatedEventHistory()).toHaveLength(10);
    expect(readCreatedEventHistory()[0].eventId).toBe('event-11');

    localStorage.setItem('kurukuru:created-events', '{broken');
    expect(readCreatedEventHistory()).toEqual([]);
  });
});
