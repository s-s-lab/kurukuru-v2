# Admin Core API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-based short-lived admin sessions and authenticated event read/update/close/reopen APIs for the organizer management flow.

**Architecture:** Introduce a focused admin service and PostgreSQL repository beside the existing event and response features. The service owns password verification and opaque session creation; the repository owns transaction locking, session authorization, lifecycle mutation, and private admin projections. Hono routes remain thin HTTP adapters with fixed safe errors and shared rate limits.

**Tech Stack:** TypeScript, Hono, Zod, PostgreSQL/pg, Node crypto, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-admin-core-api-design.md`

## Global Constraints

- Use the existing `admin_sessions`, `events.admin_secret_hash`, and `events.version`; add no migration.
- Admin sessions expire exactly 12 hours after issue.
- Store only SHA-256 session-token hashes; never log or return passwords or stored hashes.
- Session creation limits: global 60/minute and event 10/10 minutes.
- Authenticated admin operation limits: global 300/minute and event 120/10 minutes.
- Invalid, expired, cross-event sessions and unknown/deleted events return the same `404 ADMIN_ACCESS_DENIED`.
- Request bodies are limited to 16KiB.

## Review Focus

- A valid session for event A used against event B must return 404 and must not mutate event B.
- A session expiring at the current instant must be rejected (`expires_at > now()` only).
- Repeating close on closed or reopen on open must preserve `version` and `updated_at`.
- An invalid password or malformed stored password hash must not create a session or leak the stored hash.
- A failed mutation transaction must roll back both lifecycle state and version changes.

---

### Task 1: Admin domain service and validation

**Files:**
- Create: `functions/admin/service.ts`
- Create: `functions/admin/repository.ts`
- Create: `functions/admin/validation.ts`
- Create: `functions/admin/admin-service.ts`
- Create: `functions/admin/admin-service.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `generateOpaqueToken`, and `hashOpaqueToken` from `functions/security/secrets.ts` through injected dependencies.
- Produces: `AdminService`, `AdminEvent`, `AdminAccessDeniedError`, `createAdminService(repository, dependencies?)`, `adminSessionRequestSchema`, and `adminEventUpdateSchema`.

- [ ] **Step 1: Write failing service tests**

Test names and assertions:
- `creates a 12-hour session with only the token hash persisted`
- `rejects an invalid password without creating a session`
- `delegates authenticated read, update, close, and reopen commands without exposing the token`

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- functions/admin/admin-service.test.ts`
Expected: FAIL because the admin modules do not exist.

- [ ] **Step 3: Implement the minimal domain contracts, schemas, and service**

Use `AdminRepository.findPasswordHash`, `createSession`, `getAdminEvent`, `updateEvent`, and `setEventStatus`. Validate stored password hashes only through the injected verifier. Generate one opaque token, hash it, persist the hash and `expiresAt`, and return the plaintext token only from `createSession`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- functions/admin/admin-service.test.ts functions/security/secrets.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add functions/admin
git commit -m "feat: define admin session service"
```

### Task 2: PostgreSQL admin repository

**Files:**
- Create: `functions/admin/postgres-admin-repository.ts`
- Create: `functions/admin/postgres-admin-repository.test.ts`
- Create: `functions/admin/postgres-admin-repository.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 `AdminRepository`, `AdminEvent`, and `AdminAccessDeniedError`.
- Produces: `PostgresAdminRepository` with the complete Task 1 repository contract.

- [ ] **Step 1: Write failing repository tests**

Cover literal SQL-observable behavior for session insertion, current-session/event matching, cross-event and expired rejection, admin projection mapping, basic update, lifecycle transition, and idempotent lifecycle calls. The integration test must prove failed authorization leaves status/version unchanged and a repeated lifecycle command does not increment version.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`
Expected: FAIL because `PostgresAdminRepository` does not exist.

- [ ] **Step 3: Implement repository transactions**

`createSession` deletes expired sessions for the event and inserts the hash. Authenticated operations join `admin_sessions` to a non-deleted event with `expires_at > now()` and the requested event ID. Mutations acquire `FOR UPDATE`, update only when values/state change, increment `version`, and return one `AdminEvent` projection with sorted candidate slots and responses.

- [ ] **Step 4: Run repository tests**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts functions/admin/postgres-admin-repository.integration.test.ts`
Expected: unit tests PASS; integration tests PASS when `DATABASE_URL` exists and otherwise skip using the repository's existing integration-test convention.

- [ ] **Step 5: Commit Task 2**

```bash
git add functions/admin/postgres-admin-repository.ts functions/admin/postgres-admin-repository.test.ts functions/admin/postgres-admin-repository.integration.test.ts
git commit -m "feat: persist authenticated admin operations"
```

### Task 3: Admin HTTP routes and runtime wiring

**Files:**
- Modify: `functions/app.ts`
- Modify: `functions/app.test.ts`
- Modify: `functions/runtime.ts`
- Modify: `functions/runtime.test.ts`
- Modify: `docs/api-contract.md`

**Interfaces:**
- Consumes: Task 1 `AdminService` and validation schemas.
- Produces: `POST /events/:eventId/admin/sessions`, `GET /events/:eventId/admin`, `PATCH /events/:eventId`, `POST /events/:eventId/close`, and `POST /events/:eventId/reopen`.

- [ ] **Step 1: Write failing HTTP and runtime tests**

Exercise success, 16KiB body limit, validation errors, missing/malformed bearer tokens, safe 404 authorization failures, both rate-limit scopes, service unavailable, lifecycle errors, and runtime service wiring. Assert returned/logged JSON contains no password, session hash, or upstream error detail.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- functions/app.test.ts functions/runtime.test.ts`
Expected: FAIL because admin routes and runtime service wiring do not exist.

- [ ] **Step 3: Implement thin routes and runtime composition**

Reuse `readJsonBody`, `validationFieldErrors`, `extractBearerToken`, and `enforceRateLimit`. Normalize UUID path parameters to lowercase. Map `AdminAccessDeniedError` to `404 ADMIN_ACCESS_DENIED`; all unknown errors remain the fixed `500 INTERNAL_ERROR` response.

- [ ] **Step 4: Run route and full regression tests**

Run: `npm test -- functions/app.test.ts functions/runtime.test.ts functions/admin`
Expected: PASS (DB integration skips only when `DATABASE_URL` is absent).

- [ ] **Step 5: Commit Task 3**

```bash
git add functions/app.ts functions/app.test.ts functions/runtime.ts functions/runtime.test.ts docs/api-contract.md
git commit -m "feat: expose admin core API"
```

### Task 4: Phase record and final verification

**Files:**
- Modify: `docs/phase-log.md`

**Interfaces:**
- Consumes: verified Task 1–3 implementation and test results.
- Produces: an auditable P5 admin-core progress record.

- [ ] **Step 1: Update the phase log with implemented routes, security properties, verification evidence, and remaining admin work**

- [ ] **Step 2: Run the complete quality gate**

Run: `npm run lint && npm test -- --run && npm run build && npm run build:function && npm run test:function-bundle && git diff --check`
Expected: exit 0; all non-DB tests pass and DB tests skip only when `DATABASE_URL` is absent.

- [ ] **Step 3: Commit Task 4**

```bash
git add docs/phase-log.md
git commit -m "docs: record admin core API progress"
```
