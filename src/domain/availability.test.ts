import { describe, expect, it } from 'vitest';

import { applyPaint, MARKS, type AvailabilityMap } from './availability';

describe('回答グリッドの塗り分け', () => {
  it('◎・○・△・×を仕様どおり定義する', () => {
    expect(MARKS.map((mark) => [mark.value, mark.symbol])).toEqual([
      ['best', '◎'],
      ['ok', '○'],
      ['maybe', '△'],
      ['ng', '×'],
    ]);
  });

  it('ドラッグ対象の候補枠だけに選択中の回答を適用する', () => {
    const initial: AvailabilityMap = { a: 'ok' };
    expect(applyPaint(initial, ['b', 'c'], 'best', new Set(['a', 'b', 'c']))).toEqual({
      a: 'ok',
      b: 'best',
      c: 'best',
    });
  });

  it('候補外の枠は変更しない', () => {
    expect(applyPaint({}, ['outside'], 'ng', new Set(['inside']))).toEqual({});
  });

  it('消去操作では空欄へ戻す', () => {
    expect(applyPaint({ a: 'maybe', b: 'ok' }, ['a'], null, new Set(['a', 'b']))).toEqual({
      b: 'ok',
    });
  });
});

