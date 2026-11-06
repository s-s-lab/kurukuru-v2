import { describe, expect, it } from 'vitest';

import { DAY_SLOT_INDEXES, formatTimelineHeader } from './timeline';

describe('日付別タイムライン', () => {
  it('06時から翌06時まで48個の30分枠を並べる', () => {
    expect(DAY_SLOT_INDEXES).toHaveLength(48);
    expect(DAY_SLOT_INDEXES[0]).toBe(12);
    expect(DAY_SLOT_INDEXES.at(-1)).toBe(59);
  });

  it('正時だけ2桁の時刻を表示し30分位置を空欄にする', () => {
    expect(formatTimelineHeader(12)).toBe('06');
    expect(formatTimelineHeader(13)).toBe('');
    expect(formatTimelineHeader(47)).toBe('');
    expect(formatTimelineHeader(48)).toBe('00');
    expect(formatTimelineHeader(58)).toBe('05');
  });
});
