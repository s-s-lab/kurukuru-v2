import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationPath = resolve(process.cwd(), 'db/migrations/0001_core_security.sql');
const baseMigrationPath = resolve(process.cwd(), 'db/migrations/0000_base.sql');
const responseVersionMigrationPath = resolve(process.cwd(), 'db/migrations/0003_response_version.sql');
const rateLimitMigrationPath = resolve(process.cwd(), 'db/migrations/0002_request_rate_limits.sql');
const notificationGenerationMigrationPath = resolve(
  process.cwd(),
  'db/migrations/0004_notification_generation.sql',
);
const durationAndOvernightMigrationPath = resolve(
  process.cwd(),
  'db/migrations/0005_duration_and_overnight_slots.sql',
);

describe('初期DBマイグレーション', () => {
  it('回答versionを既存行に1として追加し正の整数に制限する', () => {
    const sql = readFileSync(responseVersionMigrationPath, 'utf8');
    expect(sql.trim()).toMatch(/^ALTER TABLE responses\s+ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK \(version >= 1\);$/);
  });

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

  it('空のPostgreSQLから暫定5テーブルを再現できる', () => {
    const sql = readFileSync(baseMigrationPath, 'utf8');

    for (const table of [
      'events',
      'candidate_slots',
      'responses',
      'response_availability',
      'notification_outbox',
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${table}`);
    }
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)/i);
  });

  it('分散Function間で共有するレート制限テーブルを追加する', () => {
    const sql = readFileSync(rateLimitMigrationPath, 'utf8');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS request_rate_limits');
    expect(sql).toContain('PRIMARY KEY (scope, subject_hash)');
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)/i);
  });

  it('イベントと通知アウトボックスへ同じ通知世代を追加する', () => {
    const sql = readFileSync(notificationGenerationMigrationPath, 'utf8');
    expect(sql).toContain('ALTER TABLE events');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS notification_generation');
    expect(sql).toContain('ALTER TABLE notification_outbox');
    expect(sql).toMatch(/UPDATE events[\s\S]+notify_on_response = false/);
    expect(sql).toMatch(/organizer_email_verified_at IS NULL/);
    expect(sql).toMatch(/DELETE FROM notification_outbox AS n[\s\S]+status IN \('pending', 'failed'\)/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)/i);
  });

  it('所要時間と翌朝までの候補枠を既存DBへ追加する', () => {
    const sql = readFileSync(durationAndOvernightMigrationPath, 'utf8');
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS duration text NOT NULL DEFAULT ''");
    expect(sql).toMatch(/slot_index BETWEEN 12 AND 59/);
    expect(sql).toMatch(/final_start_slot BETWEEN 12 AND 59/);
    expect(sql).toMatch(/final_end_slot BETWEEN 13 AND 60/);
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)/i);
  });
});
