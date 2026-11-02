# Admin Lifecycle API Design

## Goal

Complete the organizer backend lifecycle operations that remain after the admin-core API: replace candidate slots, set or clear the final date/time, and logically delete an event.

## Scope

- `PUT /api/v1/events/:eventId/candidate-slots` replaces the complete desired candidate-slot set.
- `POST /api/v1/events/:eventId/finalization` sets one continuous final interval.
- `DELETE /api/v1/events/:eventId/finalization` clears the final interval.
- `DELETE /api/v1/events/:eventId` logically deletes the event and invalidates its admin sessions.
- Every operation uses the existing admin bearer session, admin-operation rate limits, safe authorization failure, and `Cache-Control: no-store` behavior.

## Non-goals

- Organizer frontend screens.
- Organizer email changes, verification, and notification delivery.
- Physical deletion or data-retention scheduling.
- Optimistic concurrency headers or client-supplied versions.
- Automatically closing an event when it is finalized.

## Constraints

- Use the existing schema and foreign keys; add no migration.
- JSON request bodies are limited to 16KiB.
- Candidate dates use ISO `YYYY-MM-DD`; a request contains 1–20 distinct dates and each date contains 1–36 distinct slot indexes from 12 through 47.
- A candidate replacement contains at most 720 slots and is normalized by date then slot index.
- A finalization starts at an existing candidate slot and has an exclusive `endSlot` from 13 through 48. Every slot from `startSlot` through `endSlot - 1` must exist on the same date.
- Invalid, expired, cross-event sessions and unknown/deleted events return the same `404 ADMIN_ACCESS_DENIED`.
- Secrets, hashes, and database error details must not appear in responses or logs.

## API contract

### Replace candidate slots

`PUT /api/v1/events/:eventId/candidate-slots`

```json
{
  "candidateSlots": [
    { "date": "2026-11-10", "slotIndexes": [18, 19, 20] }
  ]
}
```

The body is the complete desired set, not a patch. The repository locks the event row, retains matching rows and IDs, inserts missing rows, and removes obsolete rows in one transaction. For every newly inserted candidate row it creates an `ng` availability row for every existing response. Removing a candidate row removes its availability rows through the existing foreign-key cascade. A normalized no-op returns the current `AdminEvent` without changing `version` or `updated_at`.

If the event is finalized, every slot in the final interval must remain in the desired candidate set. Otherwise the request fails atomically with `409 EVENT_FINALIZED`; the organizer must clear finalization first.

### Set finalization

`POST /api/v1/events/:eventId/finalization`

```json
{
  "date": "2026-11-10",
  "startSlot": 18,
  "endSlot": 21
}
```

`endSlot` is exclusive. The repository locks the event and verifies that candidate slots 18, 19, and 20 exist for the date. A missing or non-continuous interval fails atomically with `422 INVALID_FINALIZATION` and `fieldErrors.finalization`. Repeating the identical finalization is idempotent and preserves `version` and `updated_at`; changing it increments `version` once. Setting finalization does not close the event.

### Clear finalization

`DELETE /api/v1/events/:eventId/finalization`

The operation returns the current `AdminEvent`. It clears all three finalization columns and increments `version` only when a finalization existed. Repeating it is idempotent.

### Delete event

`DELETE /api/v1/events/:eventId`

The repository locks and authorizes the event, updates `status = 'deleted'`, `deleted_at = now()`, `updated_at = now()`, and increments `version`, then deletes all admin sessions for the event in the same transaction. The route returns `204` with an empty body and `Cache-Control: no-store`. Subsequent access is denied by the existing safe `404 ADMIN_ACCESS_DENIED` boundary.

## Errors

| Condition | HTTP | Code |
|---|---:|---|
| Body is malformed JSON | 400 | `INVALID_JSON` |
| Body exceeds 16KiB | 413 | `PAYLOAD_TOO_LARGE` |
| Candidate or finalization shape is invalid | 422 | `VALIDATION_ERROR` |
| Final interval is not fully represented by candidates | 422 | `INVALID_FINALIZATION` |
| Candidate replacement removes a finalized slot | 409 | `EVENT_FINALIZED` |
| Session/event authorization fails | 404 | `ADMIN_ACCESS_DENIED` |
| Admin service is not configured | 503 | `SERVICE_UNAVAILABLE` |
| Admin rate limit is exceeded | 429 | `RATE_LIMIT_EXCEEDED` |

## Architecture

- `functions/admin/validation.ts` owns strict request validation and normalization.
- `functions/admin/service.ts` exposes request types, lifecycle errors, and service methods.
- `functions/admin/admin-service.ts` hashes bearer tokens and delegates lifecycle commands.
- `functions/admin/repository.ts` defines persistence commands.
- `functions/admin/postgres-admin-repository.ts` owns locking, set reconciliation, availability backfill, finalization validation, logical deletion, and transaction atomicity.
- `functions/app.ts` remains a thin HTTP adapter and maps lifecycle errors to stable API responses.

## Transaction invariants

1. Every mutation authorizes through the session/event join and locks the event row with `FOR UPDATE OF e` before reading or changing dependent lifecycle state.
2. Retained candidate slots keep their IDs, so retained response availability is unchanged.
3. Added candidate slots have one `ng` availability per existing response before commit.
4. Removing a finalized slot, setting an unavailable final interval, or any SQL failure rolls back all candidate, availability, event-version, and session changes.
5. Version and `updated_at` change exactly once for each effective lifecycle mutation and do not change for idempotent repeats.

## Success criteria

- Service, repository, PostgreSQL integration, and HTTP tests cover success, no-op, invalid state, authorization, rollback, and secret-safe errors.
- Candidate replacement preserves retained IDs and response marks, adds `ng` for new slots, and removes obsolete availability.
- Finalization accepts only a continuous existing interval and remains independent from open/closed status.
- Logical deletion hides the event from public/admin access and invalidates every admin session.
- Full lint, tests, application build, function bundle build/check, and `git diff --check` pass.
