import { describe, expect, it } from 'vitest';

import {
  adminSessionStorageKey,
  readAdminSession,
  writeAdminSession,
} from './admin-session';

const eventId = '11111111-1111-4111-8111-111111111111';
const session = {
  sessionToken: 'opaque-admin-session-token',
  expiresAt: '2026-11-02T12:00:00.000Z',
};

describe('organizer admin session storage model', () => {
  it('uses an event-scoped key and serializes only the token and expiry', () => {
    expect(adminSessionStorageKey(eventId)).toBe(`kurukuru:admin-session:${eventId}`);
    const inputWithUnknownFields = {
      ...session,
      password: 'private-password-sentinel',
      debug: 'private-debug-sentinel',
    };
    const serialized = writeAdminSession(inputWithUnknownFields);
    expect(JSON.parse(serialized)).toEqual(session);
    expect(serialized).not.toContain('private');
  });

  it('restores a complete session only before its expiry', () => {
    const serialized = JSON.stringify(session);
    expect(readAdminSession(serialized, Date.parse('2026-11-02T11:59:59.999Z'))).toEqual(session);
    expect(readAdminSession(serialized, Date.parse(session.expiresAt))).toBeNull();
    expect(readAdminSession(serialized, Date.parse('2026-11-02T12:00:00.001Z'))).toBeNull();
  });

  it.each([
    ['missing value', null],
    ['invalid JSON', '{private-token'],
    ['missing token', JSON.stringify({ expiresAt: session.expiresAt })],
    ['empty token', JSON.stringify({ ...session, sessionToken: '' })],
    ['missing expiry', JSON.stringify({ sessionToken: session.sessionToken })],
    ['invalid expiry', JSON.stringify({ ...session, expiresAt: 'not-a-date' })],
    ['non-object', JSON.stringify(['private-token'])],
  ])('rejects %s without exposing its contents', (_label, stored) => {
    expect(readAdminSession(stored, Date.parse('2026-11-02T00:00:00.000Z'))).toBeNull();
  });

  it('keeps sessions separate through their event-specific keys', () => {
    const otherId = '22222222-2222-4222-8222-222222222222';
    expect(adminSessionStorageKey(eventId)).not.toBe(adminSessionStorageKey(otherId));
  });
});
