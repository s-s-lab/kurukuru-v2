# Admin Lifecycle API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add authenticated candidate replacement, finalization set/clear, and logical event deletion APIs for organizer administration.

**Architecture:** Extend the existing admin service/repository boundary rather than introducing another subsystem. The PostgreSQL repository reconciles complete candidate sets under the event lock, validates finalization against stored candidates, and performs deletion/session invalidation atomically; Hono routes only validate, rate-limit, delegate, and map stable errors.

**Tech Stack:** TypeScript, Hono, Zod, PostgreSQL/pg, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-admin-lifecycle-api-design.md`

## Global Constraints

- Use the existing schema and foreign keys; add no migration.
- JSON request bodies are limited to 16KiB.
- Candidate dates use ISO `YYYY-MM-DD`; requests contain 1–20 distinct dates, 1–36 distinct indexes per date, indexes 12–47, and at most 720 slots.
- Finalization uses an exclusive end index, must cover existing continuous candidates on one date, and does not close the event.
- Invalid, expired, cross-event sessions and unknown/deleted events return `404 ADMIN_ACCESS_DENIED`.
- Effective mutations increment `version` exactly once; normalized no-ops preserve `version` and `updated_at`.
- Never expose passwords, bearer tokens, stored hashes, or database error details.

---

### Task 1: Domain contracts and normalized validation

**Files:**
- Modify: `functions/admin/service.ts`
- Modify: `functions/admin/repository.ts`
- Modify: `functions/admin/admin-service.ts`
- Modify: `functions/admin/admin-service.test.ts`
- Modify: `functions/admin/validation.ts`
- Create: `functions/admin/validation.test.ts`

**Interfaces:**
- Produces: `AdminCandidateSlotsRequest`, `AdminFinalizationRequest`, `EventFinalizedError`, `InvalidFinalizationError`.
- Produces service methods: `replaceCandidateSlots`, `setFinalization`, `clearFinalization`, and `deleteEvent`.
- Produces strict schemas `adminCandidateSlotsSchema` and `adminFinalizationSchema` with normalized output.

- [ ] **Step 1: Write failing validation tests**

Test literal normalized output for unsorted dates/indexes, and rejection of duplicate dates, duplicate indexes, out-of-range indexes, empty candidates, non-ISO dates, unknown keys, invalid finalization ranges, and non-integer indexes.

- [ ] **Step 2: Run validation tests and verify RED**

Run: `npm test -- functions/admin/validation.test.ts`

Expected: FAIL because the lifecycle schemas do not exist.

- [ ] **Step 3: Implement minimal schemas**

Define a strict candidate-day object, enforce unique dates, normalize dates/indexes, and define strict finalization input with `startSlot` 12–47, `endSlot` 13–48, and `endSlot > startSlot`.

- [ ] **Step 4: Run validation tests and verify GREEN**

Run: `npm test -- functions/admin/validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing service delegation tests**

Extend the repository fake with the four lifecycle methods. Assert each service command hashes `plain-session-token` to `sha256:plain-session-token`, passes the exact normalized request, returns the repository result, and never passes the plaintext token.

- [ ] **Step 6: Run service tests and verify RED**

Run: `npm test -- functions/admin/admin-service.test.ts`

Expected: FAIL because lifecycle methods are missing from `AdminService` and `createAdminService`.

- [ ] **Step 7: Implement minimal contracts and delegation**

Add repository command signatures, domain errors, service method signatures, and direct delegation using the existing `tokenHash` helper.

- [ ] **Step 8: Run focused tests and commit**

Run: `npm test -- functions/admin/validation.test.ts functions/admin/admin-service.test.ts`

Expected: PASS.

Commit: `feat: define admin lifecycle commands`

### Task 2: Candidate reconciliation persistence

**Files:**
- Modify: `functions/admin/postgres-admin-repository.ts`
- Modify: `functions/admin/postgres-admin-repository.test.ts`
- Modify: `functions/admin/postgres-admin-repository.integration.test.ts`

**Interfaces:**
- Consumes: `AdminRepository.replaceCandidateSlots({ eventId, tokenHash, request })`.
- Produces: an updated `AdminEvent` while preserving retained slot IDs/marks and backfilling new slots with `ng`.

- [ ] **Step 1: Write failing repository boundary tests**

Use the existing real repository with a deterministic pg boundary. Assert authorization uses `FOR UPDATE OF e`, current candidates are selected under lock, retained tuples are not deleted, missing tuples are inserted, new tuple IDs feed one `INSERT ... SELECT` availability backfill with literal `ng`, obsolete IDs are deleted, and one effective event metadata update increments version. Add a normalized no-op test that emits none of the three writes and preserves version.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: FAIL because `replaceCandidateSlots` is missing.

- [ ] **Step 3: Implement minimal transactional reconciliation**

After authorization/row lock, select candidates `FOR UPDATE`, compare by `date#slotIndex`, bulk insert additions with `RETURNING id`, backfill `response_availability` via `INSERT ... SELECT ..., 'ng'`, delete obsolete IDs, update event version/timestamp once when changed, and return `loadAdminEvent`.

- [ ] **Step 4: Run unit tests and verify GREEN**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing PostgreSQL integration tests**

Create an event with retained/removed slots and two responses. Assert retained slot IDs and marks survive, removed availability disappears, each added slot has `ng` for both responses, version increments once, a repeated request is a no-op, and a finalized slot removal throws `EventFinalizedError` with the transaction rolled back.

- [ ] **Step 6: Run integration tests and verify RED**

Run: `npm test -- functions/admin/postgres-admin-repository.integration.test.ts`

Expected: new lifecycle cases FAIL when PostgreSQL is configured; otherwise they are skipped by the existing convention.

- [ ] **Step 7: Add finalized-slot protection and verify**

Before writes, compare every `[final_start_slot, final_end_slot)` tuple on `final_date` to the desired key set and throw `EventFinalizedError` when any is absent.

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts functions/admin/postgres-admin-repository.integration.test.ts`

Expected: PASS or only environment-driven integration skip.

- [ ] **Step 8: Commit**

Commit: `feat: reconcile admin candidate slots`

### Task 3: Finalization and logical deletion persistence

**Files:**
- Modify: `functions/admin/postgres-admin-repository.ts`
- Modify: `functions/admin/postgres-admin-repository.test.ts`
- Modify: `functions/admin/postgres-admin-repository.integration.test.ts`

**Interfaces:**
- Consumes: `setFinalization`, `clearFinalization`, and `deleteEvent` repository commands.
- Produces: idempotent finalization transitions and an atomic logical-delete/session-invalidation operation.

- [ ] **Step 1: Write failing finalization unit tests**

Assert `setFinalization` locks/authenticates, verifies exact candidate indexes for the requested date, updates all three final columns and version once, preserves event status, and is a no-op for the same interval. Assert a missing index throws `InvalidFinalizationError` and rolls back. Assert `clearFinalization` clears all columns once and is idempotent.

- [ ] **Step 2: Run unit tests and verify RED**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: FAIL because finalization methods are missing.

- [ ] **Step 3: Implement finalization persistence and verify GREEN**

Select candidate indexes for the date under the event lock, compare with the literal integer range, and update only on an effective change. Clear with one conditional event update.

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: PASS.

- [ ] **Step 4: Write failing deletion unit tests**

Assert authorization precedes `UPDATE events SET status = 'deleted', deleted_at = now(), version = version + 1, updated_at = now()`, then `DELETE FROM admin_sessions WHERE event_id = $1`, commit, and return `void`. Simulate the session-delete failure and assert rollback.

- [ ] **Step 5: Run unit tests and verify RED**

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: FAIL because `deleteEvent` is missing.

- [ ] **Step 6: Implement deletion and verify GREEN**

Perform logical deletion and session invalidation in the existing transaction helper after authorization lock.

Run: `npm test -- functions/admin/postgres-admin-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Add integration coverage and verify**

Prove continuous candidate validation, finalization idempotency, clear idempotency, status independence, logical deletion, public/admin invisibility, all-session invalidation, and rollback on an injected failure where practical.

Run: `npm test -- functions/admin/postgres-admin-repository.integration.test.ts`

Expected: PASS when PostgreSQL is configured, otherwise skip.

- [ ] **Step 8: Commit**

Commit: `feat: manage finalization and deletion`

### Task 4: HTTP lifecycle routes and error contract

**Files:**
- Modify: `functions/app.ts`
- Modify: `functions/app.test.ts`
- Modify: `docs/api-contract.md`

**Interfaces:**
- Consumes: lifecycle schemas, `AdminService`, `EventFinalizedError`, and `InvalidFinalizationError`.
- Produces: the four routes from the spec with shared admin authorization, limits, cache prevention, and stable errors.

- [ ] **Step 1: Write failing HTTP tests**

Extend the complete `AdminService` fake. Assert PUT candidate replacement and POST finalization pass normalized input; DELETE finalization returns `200 AdminEvent`; DELETE event returns `204` with an empty body. Include all new routes in no-store checks. Add validation, 16KiB, bearer, rate-limit, service-unavailable, `EVENT_FINALIZED`, and `INVALID_FINALIZATION` cases.

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm test -- functions/app.test.ts`

Expected: FAIL because lifecycle routes/error mappings do not exist.

- [ ] **Step 3: Implement thin lifecycle routes**

Factor a shared admin JSON parser using the 16KiB limit, reuse `readAdminAccess` and `enforceAdminOperationLimits`, delegate each command, set no-store before any response, and return an empty `204` for deletion.

- [ ] **Step 4: Add stable error mappings**

Map `EventFinalizedError` to `409 EVENT_FINALIZED`; map `InvalidFinalizationError` to `422 INVALID_FINALIZATION` with `fieldErrors.finalization`. Keep unknown error logging name-only.

- [ ] **Step 5: Run route and admin regression tests**

Run: `npm test -- functions/app.test.ts functions/admin`

Expected: PASS or only environment-driven DB skips.

- [ ] **Step 6: Update API contract and commit**

Document request bodies, exclusive end semantics, reconciliation behavior, idempotency, errors, and delete response.

Commit: `feat: expose admin lifecycle API`

### Task 5: Phase record and full verification

**Files:**
- Modify: `docs/phase-log.md`

**Interfaces:**
- Consumes: verified Tasks 1–4.
- Produces: an auditable phase record and clean branch ready for review.

- [ ] **Step 1: Update phase log**

Record routes, transaction invariants, candidate/backfill behavior, finalization rules, deletion behavior, test counts, and remaining organizer UI work.

- [ ] **Step 2: Run complete quality gate**

Run each command independently and require exit 0:

```bash
npm run lint
npm test -- --run
npm run build
npm run build:function
npm run test:function-bundle
git diff --check
```

- [ ] **Step 3: Review requirements and repository state**

Re-read the spec success criteria, inspect `git diff --stat`, `git diff`, and `git status --short --branch`, and verify no unrelated files or secrets are present.

- [ ] **Step 4: Commit**

Commit: `docs: record admin lifecycle API progress`
