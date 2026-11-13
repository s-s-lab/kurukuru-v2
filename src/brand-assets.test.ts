import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('Kurukuruのブランド画像', () => {
  function expectPng(path: string, size: number, maxBytes: number) {
    const file = readFileSync(resolve(process.cwd(), path));
    expect(file.subarray(1, 4).toString()).toBe('PNG');
    expect(file.readUInt32BE(16)).toBe(size);
    expect(file.readUInt32BE(20)).toBe(size);
    expect(statSync(resolve(process.cwd(), path)).size).toBeLessThanOrEqual(maxBytes);
  }

  it('用途別の正方形アイコンをファビコンとホーム画面アイコンに使う', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');

    expect(html).toContain('<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png" />');
    expect(html).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />');
    expectPng('public/kurukuru-icon-v1.png', 512, 100_000);
    expectPng('public/favicon-32.png', 32, 10_000);
    expectPng('public/apple-touch-icon.png', 180, 50_000);
  });
});
