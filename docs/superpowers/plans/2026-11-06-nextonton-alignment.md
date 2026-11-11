# Kurukuru Nextonton Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kurukuruを1000px幅へ統一し、所要時間、06:00〜翌06:00の候補時間、名前クリックによる公開回答編集、ネクストトントン参照表記を実装する。

**Architecture:** 既存のReact/TypeScriptフロントエンドとHono/PostgreSQL APIを維持する。イベント型へ `duration` を追加し、時間枠の上限を59へ拡張する。既存トークン編集経路を壊さず、イベントIDを含む公開編集経路を追加する。

**Tech Stack:** React 19, TypeScript 6, Hono, Zod, PostgreSQL/Neon, Vitest, Testing Library, Vite

**Spec:** `docs/superpowers/specs/2026-11-06-nextonton-alignment-design.md`

## Global Constraints

- 主要コンテンツの最大幅は1000px。
- 時間範囲は06:00〜翌06:00の48枠。
- 時間見出しは正時のみ2桁表示、30分位置は空欄。
- 所要時間は任意・最大100文字。
- 公開回答編集はブラウザ保存情報や認証トークンに依存しない。
- ネクストトントンへのリンクは `https://nextonton.inotai.net/`。
- 既存イベントと既存トークン編集APIの互換性を維持する。

---

### Task 1: Timeline domain and database migration

**Files:**
- Modify: `src/domain/slots.ts`
- Modify: `src/domain/slots.test.ts`
- Modify: `src/domain/timeline.ts`
- Modify: `functions/events/validation.ts`
- Modify: `functions/admin/validation.ts`
- Create: `db/migrations/0005_duration_and_overnight_slots.sql`
- Modify: `src/db/migration.test.ts`
- Modify: `src/db/migration.integration.test.ts`

**Interfaces:**
- Produces: candidate slot index range `12..59`, boundary range through `60`, `DAY_SLOT_INDEXES` with 48 values, and `formatTimelineHeader(slotIndex)` returning `06`/empty/`07`.

- [ ] **Step 1: Write failing domain, validation, and migration tests**

Add expectations that slot 48 starts at `00:00`, slot 59 ends at `06:00`, index 60 is rejected, timeline headers omit half-hours, create/admin schemas accept 59, and migration SQL adds `duration` plus replaces slot constraints.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/domain/slots.test.ts src/db/migration.test.ts functions/events/event-service.test.ts functions/admin/validation.test.ts`

Expected: failures for overnight slots and missing migration.

- [ ] **Step 3: Implement time wrapping and migration**

Use modulo-24-hour formatting for display while keeping monotonically increasing slot indexes. Add `duration text NOT NULL DEFAULT ''`; drop and recreate `candidate_slots_slot_index_check`, `events_final_start_slot_check`, and `events_final_end_slot_check` for the new ranges.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/domain/slots.test.ts src/db/migration.test.ts functions/admin/validation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/domain functions/events/validation.ts functions/admin/validation.ts db/migrations src/db && git commit -m "feat: extend scheduling through next-day 06:00"`

### Task 2: Persist and expose event duration

**Files:**
- Modify: `functions/events/service.ts`
- Modify: `functions/events/repository.ts`
- Modify: `functions/events/event-service.ts`
- Modify: `functions/events/postgres-event-repository.ts`
- Modify: `functions/events/event-service.test.ts`
- Modify: `functions/events/postgres-event-repository.test.ts`
- Modify: `functions/admin/service.ts`
- Modify: `functions/admin/validation.ts`
- Modify: `functions/admin/postgres-admin-repository.ts`
- Modify: `functions/admin/admin-service.test.ts`
- Modify: `functions/admin/postgres-admin-repository.test.ts`
- Modify: `functions/app.test.ts`

**Interfaces:**
- Produces: `PublicEvent.duration: string`, `CreateEventCommand.request.duration: string`, `AdminEvent.duration: string`, and `AdminEventUpdateRequest.duration: string`.

- [ ] **Step 1: Add failing service and repository tests**

Require create/get/update results to carry `duration: '1時間程度'`, validation to trim it, and SQL parameters/row mapping to include it.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- functions/events/event-service.test.ts functions/events/postgres-event-repository.test.ts functions/admin/admin-service.test.ts functions/admin/postgres-admin-repository.test.ts functions/app.test.ts`

Expected: type or assertion failures for missing `duration`.

- [ ] **Step 3: Implement duration across event and admin layers**

Add `duration` to Zod schemas, persistence inputs, SQL column lists, row types, public/admin mappers, create hashing input, and admin update statements. Default absent create values to an empty string for compatibility.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add functions src/db && git commit -m "feat: persist event duration"`

### Task 3: Add tokenless public response editing

**Files:**
- Modify: `functions/responses/service.ts`
- Modify: `functions/responses/response-service.ts`
- Modify: `functions/responses/repository.ts`
- Modify: `functions/responses/postgres-response-repository.ts`
- Modify: `functions/responses/response-service.test.ts`
- Modify: `functions/responses/postgres-response-repository.test.ts`
- Modify: `functions/responses/postgres-response-repository.integration.test.ts`
- Modify: `functions/app.ts`
- Modify: `functions/app.test.ts`
- Modify: `docs/api-contract.md`

**Interfaces:**
- Produces: `ResponseService.updatePublicResponse({ eventId, responseId, request })` and `PATCH /api/v1/events/:eventId/responses/:responseId`.
- Preserves: existing `updateResponse({ responseId, editToken, request })`.

- [ ] **Step 1: Write failing service, route, and repository tests**

Test successful public update, event/response mismatch returning the existing not-found shape, closed/deleted event rejection, foreign candidate slot rejection, notification generation, and no `Authorization` header requirement.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- functions/responses/response-service.test.ts functions/responses/postgres-response-repository.test.ts functions/app.test.ts`

Expected: missing method/route failures.

- [ ] **Step 3: Implement the public update path**

Reuse response request validation. In the repository, lock the response joined to the specified event, enforce event state, validate availability slot ownership, update response/availability/version, and enqueue an updated notification in the same transaction.

- [ ] **Step 4: Run response and route tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add functions docs/api-contract.md && git commit -m "feat: allow public response editing from event page"`

### Task 4: Update event creation and admin UI

**Files:**
- Modify: `src/features/event-create/event-draft.ts`
- Modify: `src/features/event-create/event-draft.test.ts`
- Modify: `src/features/event-create/BasicInformationStep.tsx`
- Modify: `src/features/event-create/CandidateTimeStep.tsx`
- Modify: `src/features/event-create/EventCreateFlow.test.tsx`
- Modify: `src/features/event-create/event-api.ts`
- Modify: `src/features/event-create/event-api.test.ts`
- Modify: `src/features/event-admin/AdminEventSettings.tsx`
- Modify: `src/features/event-admin/AdminEventSettings.test.tsx`
- Modify: `src/features/event-admin/admin-api.ts`
- Modify: `src/features/event-admin/admin-api.test.ts`

**Interfaces:**
- Consumes: overnight slot helpers and event/admin `duration` fields.
- Produces: duration form controls and 48-slot create/admin interactions.

- [ ] **Step 1: Write failing UI/model/API tests**

Assert duration input/request serialization, max-length validation, hour-only timeline headers, availability of 00:00〜06:00 options, and admin duration update serialization.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/features/event-create src/features/event-admin/AdminEventSettings.test.tsx src/features/event-admin/admin-api.test.ts`

Expected: missing field and timeline failures.

- [ ] **Step 3: Implement create/admin controls**

Add duration input fields and schemas. Replace hard-coded slot arrays with the shared 48-slot range. Render `formatTimelineHeader` in all create/admin table headers.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/features/event-create src/features/event-admin && git commit -m "feat: add duration and overnight time selection"`

### Task 5: Update home and public response experience

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/pages/ParticipantEventPage.tsx`
- Modify: `src/pages/ParticipantEventPage.test.tsx`
- Modify: `src/features/event-response/ParticipantResponseForm.tsx`
- Modify: `src/features/event-response/PublicAvailabilityBoard.tsx`
- Modify: `src/features/event-response/PublicAvailabilityBoard.test.tsx`
- Modify: `src/features/event-response/ResponseEditorModal.tsx`
- Modify: `src/features/event-response/response-api.ts`
- Modify: `src/features/event-response/response-api.test.ts`
- Modify: `src/features/event-response/response-model.ts`
- Modify: `src/features/event-response/response-model.test.ts`

**Interfaces:**
- Consumes: `PublicEvent.duration` and public PATCH endpoint.
- Produces: `onEditResponse(responseId)` from board to page, and modal mode `new | edit`.

- [ ] **Step 1: Write failing home and response interaction tests**

Assert exact new heading, Nextonton external link, disclaimer copy, date-based preview, duration display, clicking any response name opening populated editor, and save using the tokenless route without authorization.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- src/App.test.tsx src/pages/ParticipantEventPage.test.tsx src/features/event-response`

Expected: copy, interaction, and API call failures.

- [ ] **Step 3: Implement home and response editing flow**

Separate the new-response draft from the selected existing response draft. Pass name-button callbacks from `PublicAvailabilityBoard`; use `responseForEdit(event, responseId)`; update via the public route; refresh local event state and close the modal on success.

- [ ] **Step 4: Run focused tests**

Run the command from Step 2.

Expected: PASS.

- [ ] **Step 5: Commit**

Run: `git add src/pages src/features/event-response && git commit -m "feat: edit public responses by participant name"`

### Task 6: Apply 1000px density and verify production build

**Files:**
- Modify: `src/styles.css`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Produces: shared 1000px shell, 1000px response modal/admin shell, compact calendar, and narrow timeline cell styles.

- [ ] **Step 1: Add static layout assertions**

Assert the rendered home contains the notice section and all table headers retain accessible names even when half-hour visual labels are blank.

- [ ] **Step 2: Apply the layout refinement**

Set the shared desktop maximum to1000px, modal/admin maximum to1000px, compact the calendar without shrinking touch targets below practical mobile sizes, style response names as clear links/buttons, and preserve horizontal overflow indicators.

- [ ] **Step 3: Run full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build && npm run build:function && npm run test:function-bundle`

Expected: all commands exit 0.

- [ ] **Step 4: Run browser verification**

Check desktop and mobile for home, event creation, participant board, participant editing, and organizer page. Confirm 1000px centering, no page-level horizontal overflow, table scrolling, compact calendar, exact copy, external link, and 06〜翌06 labels.

- [ ] **Step 5: Commit**

Run: `git add src/styles.css src/App.test.tsx && git commit -m "style: align Kurukuru density with Nextonton"`

### Task 7: Publish

**Files:**
- No source files expected.

- [ ] **Step 1: Push feature branch and open pull request**

Push `feat/nextonton-alignment`, open a PR to `main`, and include test/build evidence.

- [ ] **Step 2: Verify CI and merge**

Wait for required checks, resolve failures if any, then merge the PR.

- [ ] **Step 3: Verify production deployment**

Confirm the GitHub Pages deployment succeeds and verify `https://kurukuru-app.jp/` plus one event create/response/edit flow.
