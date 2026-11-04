# Email Verification and Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify organizer email ownership and reliably deliver response notifications from `Kurukuru <no-reply@notify.kurukuru-app.jp>` through Resend.

**Architecture:** Add a fetch-based Resend adapter behind narrow mail interfaces, a PostgreSQL verification service, and an outbox dispatcher. Keep routes thin, preserve the existing response transaction, and expose a secret-protected drain endpoint for Neon scheduling. Add one admin control and one public verification page without exposing tokens or provider errors.

**Tech Stack:** TypeScript 6, Hono, PostgreSQL 18, React 19, Zod, Vitest, Resend HTTP API

**Spec:** `docs/superpowers/specs/2026-11-03-email-verification-notifications-design.md`

## Global Constraints

- Use `Kurukuru <no-reply@notify.kurukuru-app.jp>` with no Reply-To and no receiving mailbox.
- Store only SHA-256 token hashes; raw verification tokens exist only in the generated link and process memory.
- Keep existing APIs available when mail environment variables are absent; mail routes return `503 SERVICE_UNAVAILABLE`.
- Do not include comments, availability details, secrets, raw provider responses, or tokens in notification emails or logs.
- Write and run each focused failing test before production code.

---

### Task 1: Resend adapter and safe templates

**Files:**
- Create: `functions/mail/service.ts`
- Create: `functions/mail/resend-mailer.ts`
- Create: `functions/mail/templates.ts`
- Test: `functions/mail/resend-mailer.test.ts`
- Test: `functions/mail/templates.test.ts`

**Interfaces:**
- Produces: `MailSender.send(message: MailMessage): Promise<{ providerMessageId: string }>`
- Produces: `verificationMail(input)` and `responseNotificationMail(input)` returning subject, HTML, text, recipient, and idempotency key.

- [ ] **Step 1: Write failing template tests**

```ts
expect(verificationMail({ eventId, eventTitle: '<研究会>', organizerEmail, token: 'raw-token', publicBaseUrl }).html)
  .toContain('&lt;研究会&gt;');
expect(responseNotificationMail({ eventId, eventTitle: '研究会', organizerEmail, respondentName: '参加者', kind: 'created', publicBaseUrl }).text)
  .not.toContain('回答コメント');
```

- [ ] **Step 2: Run `npm test -- functions/mail/templates.test.ts` and confirm missing-module RED**
- [ ] **Step 3: Implement escaped HTML and literal text templates with the approved subjects, hash-route links, and no-reply footer**
- [ ] **Step 4: Run the template test and confirm GREEN**
- [ ] **Step 5: Write a failing Resend adapter test asserting Authorization, JSON body, `Idempotency-Key`, safe non-2xx error, and returned provider ID**
- [ ] **Step 6: Run `npm test -- functions/mail/resend-mailer.test.ts` and confirm RED**
- [ ] **Step 7: Implement the minimal fetch adapter against `https://api.resend.com/emails`**
- [ ] **Step 8: Run both mail tests and confirm GREEN**

### Task 2: Organizer verification service and PostgreSQL repository

**Files:**
- Create: `functions/email-verifications/service.ts`
- Create: `functions/email-verifications/email-verification-service.ts`
- Create: `functions/email-verifications/repository.ts`
- Create: `functions/email-verifications/postgres-email-verification-repository.ts`
- Test: `functions/email-verifications/email-verification-service.test.ts`
- Test: `functions/email-verifications/postgres-email-verification-repository.test.ts`
- Test: `functions/email-verifications/postgres-email-verification-repository.integration.test.ts`

**Interfaces:**
- Produces: `EmailVerificationService.send({ eventId, sessionToken }): Promise<{ status: 'sent' | 'already-verified' }>`
- Produces: `EmailVerificationService.verify(token): Promise<{ eventId: string; status: 'verified' }>`
- Repository consumes session-token hash and new verification-token hash; it never receives the raw token.

- [ ] **Step 1: Write failing service tests for token rotation, 24-hour expiry, verified no-op, mail failure, and token hashing**
- [ ] **Step 2: Run the service test and confirm RED**
- [ ] **Step 3: Implement the minimal service using injected clock, token generator, hash function, repository, and mail sender**
- [ ] **Step 4: Run the service test and confirm GREEN**
- [ ] **Step 5: Write repository tests for admin authorization, prepared send data, idempotent verification, expiry, deleted event, and dual-table timestamps**
- [ ] **Step 6: Run repository tests and confirm RED**
- [ ] **Step 7: Implement PostgreSQL transactions using row locks and fixed `EmailVerificationNotFoundError` / `AdminAccessDeniedError` boundaries**
- [ ] **Step 8: Run unit tests; run integration tests when `DATABASE_URL` exists**

### Task 3: Verification HTTP routes and runtime configuration

**Files:**
- Modify: `functions/app.ts`
- Modify: `functions/runtime.ts`
- Modify: `functions/app.test.ts`
- Modify: `functions/runtime.test.ts`
- Modify: `docs/api-contract.md`

**Interfaces:**
- Adds authenticated `POST /api/v1/events/:eventId/email-verifications`.
- Adds public `GET /api/v1/email-verifications/:token`.
- Runtime constructs mail services only when `RESEND_API_KEY`, `KURUKURU_MAIL_FROM`, and `KURUKURU_PUBLIC_BASE_URL` are all present.

- [ ] **Step 1: Add failing HTTP tests for admin authorization, specific send limits, sent/already-verified responses, no-store headers, invalid token 404, and mail-service 503**
- [ ] **Step 2: Run focused app tests and confirm RED**
- [ ] **Step 3: Add thin routes and fixed safe error mappings**
- [ ] **Step 4: Run focused app tests and confirm GREEN**
- [ ] **Step 5: Add failing runtime tests for absent optional mail config and complete Resend wiring**
- [ ] **Step 6: Implement optional runtime wiring and run runtime tests GREEN**
- [ ] **Step 7: Update the API contract with exact status codes and response bodies**

### Task 4: Notification outbox dispatcher

**Files:**
- Create: `functions/notifications/service.ts`
- Create: `functions/notifications/notification-dispatcher.ts`
- Create: `functions/notifications/repository.ts`
- Create: `functions/notifications/postgres-notification-repository.ts`
- Test: `functions/notifications/notification-dispatcher.test.ts`
- Test: `functions/notifications/postgres-notification-repository.test.ts`
- Test: `functions/notifications/postgres-notification-repository.integration.test.ts`
- Modify: `functions/app.ts`
- Modify: `functions/runtime.ts`
- Modify: `functions/app.test.ts`
- Modify: `functions/runtime.test.ts`

**Interfaces:**
- Produces: `NotificationDispatcher.drain(10): Promise<{ processed: number; sent: number; failed: number }>`.
- Adds `POST /api/v1/internal/notifications/drain` guarded by `Authorization: Bearer <KURUKURU_NOTIFICATION_WORKER_SECRET>`.

- [ ] **Step 1: Write failing dispatcher tests for sent, failed, provider idempotency, batch counts, and safe error truncation**
- [ ] **Step 2: Run dispatcher tests and confirm RED**
- [ ] **Step 3: Implement minimal sequential delivery and repository state transitions**
- [ ] **Step 4: Run dispatcher tests GREEN**
- [ ] **Step 5: Write failing PostgreSQL tests for `SKIP LOCKED`, stale-sending recovery, attempt increment, provider ID, and 1m/2m/4m capped backoff**
- [ ] **Step 6: Implement the claim/sent/failed queries and run unit/integration tests**
- [ ] **Step 7: Write failing HTTP/runtime tests for wrong worker secret, missing configuration, and successful drain**
- [ ] **Step 8: Implement the secret-protected route and runtime wiring, then run focused tests GREEN**

### Task 5: Admin verification control and public verification page

**Files:**
- Create: `src/features/event-admin/AdminEmailVerification.tsx`
- Test: `src/features/event-admin/AdminEmailVerification.test.tsx`
- Create: `src/pages/EmailVerificationPage.tsx`
- Test: `src/pages/EmailVerificationPage.test.tsx`
- Modify: `src/features/event-admin/admin-api.ts`
- Modify: `src/features/event-admin/admin-api.test.ts`
- Modify: `src/pages/AdminEventPage.tsx`
- Modify: `src/pages/AdminEventPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Adds `sendAdminEmailVerification(eventId, options)` returning `sent | already-verified`.
- Adds `verifyOrganizerEmail(token, options)` returning the verified event ID.

- [ ] **Step 1: Write failing API-client tests for the authenticated POST and public GET, including malformed success and safe error bodies**
- [ ] **Step 2: Run API-client tests RED, implement clients, and run GREEN**
- [ ] **Step 3: Write failing component tests for unverified send/resend, verified state, pending state, and the notification-disabled explanation**
- [ ] **Step 4: Implement `AdminEmailVerification` and run its tests GREEN**
- [ ] **Step 5: Write failing page/router tests for checking, verified, expired/invalid, and retryable failure states without rendering the token**
- [ ] **Step 6: Implement the verification page and route, then run page/router tests GREEN**
- [ ] **Step 7: Connect the admin page operation to its existing mutation lock and session-expiry handling; run admin page tests GREEN**
- [ ] **Step 8: Add focused responsive styles using the existing navy/teal/pale-aqua system**

### Task 6: Documentation and full verification

**Files:**
- Modify: `docs/architecture.md`
- Modify: `docs/p0-status.md`
- Modify: `docs/phase-log.md`

**Interfaces:** None.

- [ ] **Step 1: Document `kurukuru-app.jp`, XServer DNS, Resend variables, the worker endpoint, and the remaining external domain-verification step**
- [ ] **Step 2: Run `npm test` and confirm all non-DB tests pass with only expected DB skips**
- [ ] **Step 3: Run `npm run lint` and confirm zero warnings/errors**
- [ ] **Step 4: Run `npm run typecheck`, `npm run build`, `npm run build:function`, and `npm run test:function-bundle` separately and confirm success**
- [ ] **Step 5: Run `git diff --check` and inspect `git status --short`**
- [ ] **Step 6: Record exact test counts and remaining Resend/XServer/Neon external setup in `docs/phase-log.md`**
