import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readCreatedEventHistory, removeCreatedEventHistory, saveCreatedEventHistory } from './event-history';

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


describe('作成イベントを履歴から削除', () => {
  const item = (eventId: string) => ({
    eventId, title: eventId, createdAt: '2026-11-05T10:00:00.000Z',
    participantUrl: `https://example.test/#/events/${eventId}`,
    organizerUrl: `https://example.test/#/events/${eventId}/admin`,
  });
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('最新の保存内容から指定IDだけを除き、順序と管理セッションを保つ', () => {
    saveCreatedEventHistory(item('first'));
    saveCreatedEventHistory(item('second'));
    readCreatedEventHistory();
    saveCreatedEventHistory(item('third'));
    localStorage.setItem('kurukuru:admin-session:second', 'keep-session');
    sessionStorage.setItem('kurukuru:admin-session:second', 'keep-tab-session');
    expect(removeCreatedEventHistory('second')?.map(({ eventId }) => eventId)).toEqual(['third', 'first']);
    expect(readCreatedEventHistory().map(({ eventId }) => eventId)).toEqual(['third', 'first']);
    expect(localStorage.getItem('kurukuru:admin-session:second')).toBe('keep-session');
    expect(sessionStorage.getItem('kurukuru:admin-session:second')).toBe('keep-tab-session');
    expect(removeCreatedEventHistory('unknown')?.map(({ eventId }) => eventId)).toEqual(['third', 'first']);
    expect(readCreatedEventHistory().map(({ eventId }) => eventId)).toEqual(['third', 'first']);
  });

  it('同じIDの重複をすべて除き、最後の履歴は空に保存する', () => {
    localStorage.setItem('kurukuru:created-events', JSON.stringify([item('first'), item('first')]));
    expect(removeCreatedEventHistory('first')).toEqual([]);
    expect(JSON.parse(localStorage.getItem('kurukuru:created-events')!)).toEqual([]);
  });

  it('壊れた保存値は空の履歴として扱う', () => {
    localStorage.setItem('kurukuru:created-events', '{broken');
    expect(removeCreatedEventHistory('first')).toEqual([]);
    expect(readCreatedEventHistory()).toEqual([]);
  });

  it('保存できないときは失敗を返し、保存済みの履歴を保つ', () => {
    saveCreatedEventHistory(item('first'));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(removeCreatedEventHistory('first')).toBeNull();
    expect(readCreatedEventHistory()[0].eventId).toBe('first');
  });

  it('読み出せないときは失敗を返し、履歴を上書きしない', () => {
    saveCreatedEventHistory(item('first'));
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
    expect(removeCreatedEventHistory('first')).toBeNull();
    read.mockRestore();
    expect(readCreatedEventHistory()[0].eventId).toBe('first');
  });
});
