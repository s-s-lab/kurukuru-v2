// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  generateOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from './secrets';

describe('秘密情報の管理', () => {
  it('URLで扱える十分に長いランダムトークンを生成する', () => {
    const first = generateOpaqueToken();
    const second = generateOpaqueToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).not.toBe(second);
  });

  it('編集トークンはハッシュだけを比較できる', () => {
    const token = generateOpaqueToken();
    expect(hashOpaqueToken(token)).toBe(hashOpaqueToken(token));
    expect(hashOpaqueToken(token)).not.toBe(hashOpaqueToken(`${token}x`));
  });

  it('管理パスワードをソルト付きで保存し検証する', async () => {
    const password = 'correct horse battery staple';
    const encoded = await hashPassword(password);

    expect(encoded).not.toContain(password);
    expect(await verifyPassword(password, encoded)).toBe(true);
    expect(await verifyPassword('wrong password', encoded)).toBe(false);
  });
});

