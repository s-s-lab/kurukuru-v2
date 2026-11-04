import { describe, expect, it, vi } from 'vitest';

import type { AdminEvent } from './service';
import type { AdminRepository } from './repository';
import { AdminAccessDeniedError, createAdminService } from './admin-service';

const eventId = '9bed1489-b31f-4b6d-8dcb-e8d95109f98c';
const now = new Date('2026-11-02T00:00:00.000Z');

const adminEvent: AdminEvent = {
  id: eventId,
  title: '研究会の日程調整',
  description: '候補日時を選んでください。',
  organizerEmail: 'organizer@example.com',
  organizerEmailVerified: false,
  notifyOnResponse: true,
  status: 'open',
  finalization: null,
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [],
  responses: [],
};

function repository(overrides: Partial<AdminRepository> = {}): AdminRepository {
  return {
    findPasswordHash: vi.fn().mockResolvedValue('scrypt$stored-hash'),
    createSession: vi.fn().mockResolvedValue(adminEvent),
    getAdminEvent: vi.fn().mockResolvedValue(adminEvent),
    updateEvent: vi.fn().mockResolvedValue(adminEvent),
    setEventStatus: vi.fn().mockResolvedValue(adminEvent),
    replaceCandidateSlots: vi.fn().mockResolvedValue(adminEvent),
    setFinalization: vi.fn().mockResolvedValue(adminEvent),
    clearFinalization: vi.fn().mockResolvedValue(adminEvent),
    deleteEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('admin service', () => {
  it('creates a 12-hour session with only the token hash persisted', async () => {
    const adminRepository = repository();
    const verifyPassword = vi.fn().mockResolvedValue(true);
    const service = createAdminService(adminRepository, {
      now: () => now,
      verifyPassword,
      generateToken: () => 'opaque-session-token',
      hashToken: (token) => `sha256:${token}`,
    });

    const result = await service.createSession({
      eventId,
      password: 'correct horse battery staple',
    });

    expect(verifyPassword).toHaveBeenCalledWith(
      'correct horse battery staple',
      'scrypt$stored-hash',
    );
    expect(adminRepository.createSession).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:opaque-session-token',
      expiresAt: new Date('2026-11-02T12:00:00.000Z'),
    });
    expect(result).toEqual({
      sessionToken: 'opaque-session-token',
      expiresAt: '2026-11-02T12:00:00.000Z',
      event: adminEvent,
    });
    expect(JSON.stringify(result)).not.toContain('stored-hash');
  });

  it('rejects an invalid password without creating a session', async () => {
    const adminRepository = repository();
    const service = createAdminService(adminRepository, {
      now: () => now,
      verifyPassword: vi.fn().mockResolvedValue(false),
      generateToken: () => 'must-not-be-generated',
      hashToken: (token) => token,
    });

    await expect(service.createSession({ eventId, password: 'wrong password' }))
      .rejects.toBeInstanceOf(AdminAccessDeniedError);
    expect(adminRepository.createSession).not.toHaveBeenCalled();
  });

  it('delegates authenticated read, update, close, and reopen commands without exposing the token', async () => {
    const adminRepository = repository();
    const service = createAdminService(adminRepository, {
      now: () => now,
      verifyPassword: vi.fn(),
      generateToken: () => 'unused',
      hashToken: (token) => `sha256:${token}`,
    });
    const sessionToken = 'plain-session-token';
    const update = {
      title: '更新後の研究会',
      description: '更新後の説明',
      organizerEmail: 'organizer@example.com',
      notifyOnResponse: false,
    };

    await expect(service.getEvent({ eventId, sessionToken })).resolves.toEqual(adminEvent);
    await expect(service.updateEvent({ eventId, sessionToken, request: update }))
      .resolves.toEqual(adminEvent);
    await expect(service.closeEvent({ eventId, sessionToken })).resolves.toEqual(adminEvent);
    await expect(service.reopenEvent({ eventId, sessionToken })).resolves.toEqual(adminEvent);

    expect(adminRepository.getAdminEvent).toHaveBeenCalledWith(eventId, 'sha256:plain-session-token');
    expect(adminRepository.updateEvent).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:plain-session-token',
      request: update,
    });
    expect(adminRepository.setEventStatus).toHaveBeenNthCalledWith(1, {
      eventId,
      tokenHash: 'sha256:plain-session-token',
      status: 'closed',
    });
    expect(adminRepository.setEventStatus).toHaveBeenNthCalledWith(2, {
      eventId,
      tokenHash: 'sha256:plain-session-token',
      status: 'open',
    });
    expect(JSON.stringify(adminRepository)).not.toContain(sessionToken);
  });

  it('delegates lifecycle commands with only the session token hash', async () => {
    const adminRepository = repository();
    const service = createAdminService(adminRepository, {
      now: () => now,
      verifyPassword: vi.fn(),
      generateToken: () => 'unused',
      hashToken: (token) => `sha256:${token}`,
    });
    const sessionToken = 'plain-session-token';
    const candidateRequest = {
      candidateSlots: [{ date: '2026-11-10', slotIndexes: [18, 19] }],
    };
    const finalizationRequest = { date: '2026-11-10', startSlot: 18, endSlot: 20 };

    await expect(service.replaceCandidateSlots({
      eventId,
      sessionToken,
      request: candidateRequest,
    })).resolves.toEqual(adminEvent);
    await expect(service.setFinalization({
      eventId,
      sessionToken,
      request: finalizationRequest,
    })).resolves.toEqual(adminEvent);
    await expect(service.clearFinalization({ eventId, sessionToken })).resolves.toEqual(adminEvent);
    await expect(service.deleteEvent({ eventId, sessionToken })).resolves.toBeUndefined();

    expect(adminRepository.replaceCandidateSlots).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:plain-session-token',
      request: candidateRequest,
    });
    expect(adminRepository.setFinalization).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:plain-session-token',
      request: finalizationRequest,
    });
    expect(adminRepository.clearFinalization).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:plain-session-token',
    });
    expect(adminRepository.deleteEvent).toHaveBeenCalledWith({
      eventId,
      tokenHash: 'sha256:plain-session-token',
    });
    expect(JSON.stringify(adminRepository)).not.toContain(sessionToken);
  });
});
