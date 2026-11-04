# Organizer Admin UI Implementation Plan

> **For Codex:** Execute this plan inline with `executing-plans`, following strict RED/GREEN TDD and the approved Hallmark design direction.

**Goal:** Deliver the first organizer admin workspace at `#/events/:eventId/admin`, including password login, same-tab session restoration, response visibility, basic settings updates, participant URL sharing, and reversible response close/reopen controls.

**Architecture:** Keep API validation and bearer handling in a dedicated client, browser-session serialization in a pure model, and display derivations in a pure admin model. `AdminEventPage` owns the `checking-session → login → authenticated` state machine and passes data/actions to presentational components that never read storage or call APIs directly.

**Tech Stack:** React 19, TypeScript 6, React Router 7, Zod 4, Vitest 5, Testing Library, existing CSS design tokens and Hono admin API.

**Spec:** `docs/superpowers/specs/2026-11-02-organizer-admin-ui-design.md`

**Global Constraints:** Do not change the backend contract. Never place the password or session token in the URL, DOM, logs, `localStorage`, error text, or analytics. Persist only `{ sessionToken, expiresAt }` in event-scoped `sessionStorage`. Keep the first slice limited to display, basic metadata/notification updates, and close/reopen; candidate editing, finalization editing, and deletion remain out of scope.

---

## Task 1: Add a validated admin API boundary

**Files:**
- Create: `src/features/event-admin/admin-api.test.ts`
- Create: `src/features/event-admin/admin-api.ts`

1. Add failing API-client tests using a complete `AdminEvent` fixture. Cover session creation, authenticated GET, PATCH with normalized `{ title, description, notifyOnResponse }`, close, and reopen. Assert exact URLs, methods, JSON body, and `Authorization: Bearer …` without rendering the token.
2. Add failing tests for network errors, documented errors, non-JSON failures, malformed success JSON, and a malformed response containing a secret sentinel. Assert `AdminApiError` exposes only `status`, `code`, `message`, `fieldErrors`, and `requestId`, and never the sentinel.
3. Run `npm test -- --run src/features/event-admin/admin-api.test.ts` and confirm RED because the module is absent.
4. Implement Zod schemas mirroring every documented `AdminEvent` field and the session result. Implement `createAdminSession`, `getAdminEvent`, `updateAdminEvent`, `closeAdminEvent`, and `reopenAdminEvent` with one safe JSON request helper and operation-appropriate fallback messages.
5. Re-run the focused test to GREEN, then refactor shared URL/header construction without changing behavior.

## Task 2: Add event-scoped same-tab session storage

**Files:**
- Create: `src/features/event-admin/admin-session.test.ts`
- Create: `src/features/event-admin/admin-session.ts`

1. Add failing pure-model tests for `adminSessionStorageKey(eventId)`, serializing only `sessionToken` and `expiresAt`, restoring before expiry, rejecting at the exact expiry boundary, rejecting malformed JSON/fields, and keeping different event IDs isolated.
2. Assert the serialized value does not contain a supplied password sentinel or any unknown input field.
3. Run the focused test and confirm RED.
4. Implement `StoredAdminSession`, safe parse/write helpers, and a read function that receives the stored string and current epoch milliseconds so expiry behavior stays deterministic. Keep Web Storage access in the page, not the model.
5. Re-run to GREEN and perform a mutation check for inverted expiry and missing field validation.

## Task 3: Build response-display derivations and the overview

**Files:**
- Create: `src/features/event-admin/admin-model.test.ts`
- Create: `src/features/event-admin/admin-model.ts`
- Create: `src/features/event-admin/AdminResponseOverview.test.tsx`
- Create: `src/features/event-admin/AdminResponseOverview.tsx`

1. Add failing table-driven model tests for candidate ordering, distinct dates, visible slot bounds, candidate-date range text, `[startSlot, endSlot)` finalization text, and literal `best|ok|maybe|ng` counts for sparse slots and multiple responses.
2. Run the model test and confirm RED, then implement derivations using existing `formatSlotStart`/`formatSlotEnd`; do not calculate a score.
3. Add failing component tests that render the real overview and assert: a labeled management timetable, all four symbol/count values, candidate range, unfinalized/finalized text, response names/comments/updated times, and the zero-response sharing prompt.
4. Run and confirm RED, then implement the accessible read-only table with sticky date column semantics and a response list. Preserve API response ordering in the list.
5. Re-run both focused files to GREEN.

## Task 4: Build login, header, and settings components

**Files:**
- Create: `src/features/event-admin/AdminLoginForm.test.tsx`
- Create: `src/features/event-admin/AdminLoginForm.tsx`
- Create: `src/features/event-admin/AdminEventHeader.tsx`
- Create: `src/features/event-admin/AdminEventSettings.test.tsx`
- Create: `src/features/event-admin/AdminEventSettings.tsx`

1. Add a failing login-form test that asserts a permanent password label, password input type, disabled submit while pending, safe error/request ID display, and callback submission of the typed value without rendering it elsewhere.
2. Implement the controlled login component and clear its local password immediately after submit resolves or rejects; ensure unmount drops the state naturally.
3. Add failing settings tests for title/description/notification editing, local validation, `aria-invalid`/`aria-describedby`, disabled per-operation buttons, normalized update callback payload, and open/closed close/reopen labels with reversible-action help text.
4. Implement a draft that resynchronizes when a newly returned event arrives. Submit only valid title (1–120) and description (0–2000), and keep save/status live messages separate.
5. Implement the header as a presentational component with title, status text, and participant URL share/copy action. Re-run all focused tests to GREEN.

## Task 5: Connect the page state machine and route

**Files:**
- Create: `src/pages/AdminEventPage.test.tsx`
- Create: `src/pages/AdminEventPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

1. Add failing page integration tests with complete server responses for:
   - no stored session shows login without event title;
   - password login stores only token/expiry in `sessionStorage`, clears password from DOM, and renders the workspace;
   - a valid stored session performs authenticated GET and restores without login;
   - expired/malformed stored state is removed before showing login;
   - `ADMIN_ACCESS_DENIED` during restore or any authenticated operation removes the session and returns to login with a safe expiry message;
   - settings save replaces the event state and close/reopen replace status;
   - duplicate submits are suppressed while their own operation is pending;
   - share uses `navigator.share` when available and clipboard fallback otherwise, with no token/password in DOM or `localStorage`.
2. Run the page test and confirm RED.
3. Implement `AdminEventPage` with explicit page state, cancellation guards for initial async work, independent login/settings/status/share messages, and helpers that centralize access-denied handling. Build the participant URL from `window.location.origin`, `window.location.pathname`, and `#/events/:eventId`, never from the session token.
4. Add the `/events/:eventId/admin` route and a route test asserting the login heading renders. Run the page and app tests to GREEN.
5. Run all frontend tests and fix only behavior covered by this approved slice.

## Task 6: Apply the approved responsive visual system

**Files:**
- Modify: `src/styles.css`

1. Add admin-specific styles under one section using existing navy/teal/aqua/line tokens. Keep the response timetable as the dominant surface; avoid nested cards, gradients, fake KPI tiles, and sticky settings.
2. Implement desktop `minmax(0, 2fr) minmax(300px, 1fr)` layout and stack at 900px. At 640px, make share/status actions full width, reduce fixed date-column width, keep the table internally scrollable, and avoid page-level horizontal overflow at 320px.
3. Ensure all interactive elements have at least 44px height, visible teal focus rings, text+symbol+color status cues, and live regions for results. Respect reduced motion by not requiring animation.
4. Run component/page tests to catch semantic regressions, then inspect the DOM/CSS against the approved spec at desktop and mobile breakpoints. If a reachable browser is unavailable, record that limitation rather than claiming rendered visual verification.

## Task 7: Record and verify the completed slice

**Files:**
- Modify: `docs/phase-log.md`

1. Add the P5 organizer admin UI entry covering implemented scope, session security, accessibility/responsive behavior, TDD evidence, and explicitly deferred candidate/finalization/delete controls.
2. Run focused tests for all new admin files.
3. Run the full verification suite:
   - `npm run lint`
   - `npm test -- --run`
   - `npm run build`
   - `npm run build:function`
   - `npm run test:function-bundle`
   - `git diff --check`
4. Review `git diff --stat` and `git status --short`; confirm no generated secrets, tokens, debug logs, or unrelated files are present.
5. Commit the completed feature as `feat: add organizer admin workspace` only after all available checks pass.

