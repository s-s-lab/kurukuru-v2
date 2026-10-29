import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'db/migrations/0001_core_security.sql');

describe('初期DBマイグレーション', () => {
  it('メール認証・管理セッション・冪等性の永続テーブルを追加する', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_verifications');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS admin_sessions');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS idempotency_keys');
    expect(sql).toContain('notification_outbox_idempotency_key_key');
  });

  it('暫定5テーブルを削除しない', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
  });
});
