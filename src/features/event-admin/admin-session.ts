import { z } from 'zod';

export type StoredAdminSession = {
  sessionToken: string;
  expiresAt: string;
};

const storedAdminSessionSchema = z.object({
  sessionToken: z.string().min(1).max(512),
  expiresAt: z.string(),
});

export function adminSessionStorageKey(eventId: string) {
  return `kurukuru:admin-session:${eventId}`;
}

export function writeAdminSession(session: StoredAdminSession) {
  return JSON.stringify({
    sessionToken: session.sessionToken,
    expiresAt: session.expiresAt,
  });
}

export function readAdminSession(
  stored: string | null,
  nowMilliseconds = Date.now(),
): StoredAdminSession | null {
  if (!stored) return null;

  try {
    const parsed = storedAdminSessionSchema.safeParse(JSON.parse(stored));
    if (!parsed.success) return null;
    const expiresAt = Date.parse(parsed.data.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMilliseconds) return null;
    return {
      sessionToken: parsed.data.sessionToken,
      expiresAt: parsed.data.expiresAt,
    };
  } catch {
    return null;
  }
}
