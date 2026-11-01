# Event Creation UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder event creation page with a responsive, accessible three-step flow that creates a real event through the existing API and presents participant and organizer URLs for sharing.

**Architecture:** Keep the workflow client-side and split it into a pure draft/domain module, a fetch-based API boundary, focused React step components, and a small orchestration page. The existing `POST /api/v1/events` contract is authoritative; no backend, database, or API schema changes are in scope.

**Tech Stack:** React 19, TypeScript 6, React Router 7 HashRouter, Vitest, Testing Library, CSS/Tailwind entrypoint, Lucide React.

**Spec:** `docs/api-contract.md`, `docs/design/direction.md`, and `docs/design/kurukuru-event-creation-flow-concept.png`

## Global Constraints

- Preserve the approved visual system: true white background, Deep navy `#0f2b4f`, Teal `#008f8a`, Pale aqua `#eefbfc`, and Blue gray `#cfe0e8`.
- The three steps are exactly `基本情報`, `候補日時`, and `確認`; the success state follows creation and is not a fourth numbered step.
- Candidate slots are 30-minute units from 06:00 through 24:00, represented by integer indexes 12 through 47.
- The browser sends only the existing event-create fields: `title`, `description`, `organizerEmail`, `adminPassword`, `notifyOnResponse`, and `candidateSlots`.
- Do not persist the administrator password in localStorage, sessionStorage, URL parameters, logs, or analytics.
- Use native controls and semantic labels; each time cell must be keyboard operable and expose its date, time range, and selected state to assistive technology.
- Desktop and mobile share the same DOM and behavior. Mobile uses horizontal grid scrolling and a sticky primary action rather than a separate application.
- Do not add dependencies. Use direct imports and existing Lucide icons.
- Use strict TDD: each behavior test is written and observed failing for the intended missing behavior before production code is added.
- Do not change the API, Neon environment, main database, GitHub Pages configuration, or existing response APIs in this plan.

### Design direction contract

- **Thesis:** A quiet, precise scheduling tool whose time grid is the visual and interaction focal point.
- **Own world:** A meeting-room planning sheet translated into a tactile 30-minute grid.
- **First viewport:** Current step, one clear instruction, and one primary next action.
- **Form:** Japanese sans-serif, compact control typography, open white canvas, pale-aqua functional bands, 8–10px control radii, 14–18px work-surface radii, and restrained borders.
- **Motion:** Only short state transitions and hover/focus feedback; respect `prefers-reduced-motion`.
- **Anti-references:** No gradients, glass effects, nested cards, decorative status pills, fake metrics, or marketing hero treatment inside the workflow.

---

### Task 1: Event draft domain and URL helpers

**Files:**
- Create: `src/features/event-create/event-draft.ts`
- Create: `src/features/event-create/event-draft.test.ts`

**Interfaces:**
- Produces: `EventDraft`, `CandidateDayDraft`, `createEmptyEventDraft()`, `validateBasicInformation(draft)`, `validateCandidateDays(days)`, `toggleCandidateSlot(days, date, slotIndex)`, `removeCandidateDay(days, date)`, `toCreateEventRequest(draft)`, and `buildEventUrls(eventId, location)`.
- Consumes: `normalizeSlotIndexes()` and slot-index validation from `src/domain/slots.ts`.

- [ ] **Step 1: Write failing validation and normalization tests**

  Add literal cases proving that whitespace-only titles fail, malformed email fails, passwords shorter than eight characters fail, duplicate dates fail, a day without a selected slot fails, slot toggling is immutable, and the API request is date/slot sorted while preserving the exact approved fields.

  ```ts
  expect(validateBasicInformation({ ...draft, title: '   ' })).toEqual({
    title: 'イベント名を入力してください。',
  });
  expect(toggleCandidateSlot(days, '2026-11-10', 18)).toEqual([
    { date: '2026-11-10', slotIndexes: [18] },
  ]);
  expect(toCreateEventRequest(unsortedDraft).candidateSlots).toEqual([
    { date: '2026-11-10', slotIndexes: [18, 19] },
    { date: '2026-11-12', slotIndexes: [24] },
  ]);
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- src/features/event-create/event-draft.test.ts`

  Expected: FAIL because `event-draft.ts` and its exports do not exist.

- [ ] **Step 3: Implement the minimum pure domain module**

  Use these exact public shapes:

  ```ts
  export type CandidateDayDraft = { date: string; slotIndexes: number[] };
  export type EventDraft = {
    title: string;
    description: string;
    organizerEmail: string;
    adminPassword: string;
    notifyOnResponse: boolean;
    candidateDays: CandidateDayDraft[];
  };
  export type FieldErrors = Record<string, string>;
  export type BrowserLocation = Pick<Location, 'origin' | 'pathname'>;
  ```

  `buildEventUrls()` must return absolute HashRouter URLs using the current deployment pathname:

  ```ts
  {
    participantUrl: `${location.origin}${location.pathname}#/events/${eventId}`,
    organizerUrl: `${location.origin}${location.pathname}#/events/${eventId}/admin`,
  }
  ```

- [ ] **Step 4: Run focused and existing domain tests and verify GREEN**

  Run: `npm test -- src/features/event-create/event-draft.test.ts src/domain/slots.test.ts`

  Expected: both test files PASS with no warnings.

- [ ] **Step 5: Commit Task 1**

  ```bash
  git add src/features/event-create/event-draft.ts src/features/event-create/event-draft.test.ts
  git commit -m "feat: define event creation draft model"
  ```

---

### Task 2: Typed event creation API client

**Files:**
- Create: `src/features/event-create/event-api.ts`
- Create: `src/features/event-create/event-api.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `CreateEventRequest` inferred from `toCreateEventRequest()` in Task 1.
- Produces: `createEvent(request, options)`, `CreateEventResult`, and `EventApiError`.

- [ ] **Step 1: Write failing API boundary tests**

  Cover the real observable request contract using a small fetch double that returns complete `Response` objects:

  ```ts
  expect(fetchCalls[0]).toMatchObject({
    url: 'https://api.example.test/api/v1/events',
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': 'event-create-00000001',
    },
  });
  expect(result.event.id).toBe('9bed1489-b31f-4b6d-8dcb-e8d95109f98c');
  ```

  Also prove that a 422 payload exposes `code`, `message`, `fieldErrors`, and `requestId` through `EventApiError`, while a non-JSON 502 produces a generic safe message without copying the response body.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- src/features/event-create/event-api.test.ts`

  Expected: FAIL because the client does not exist.

- [ ] **Step 3: Implement the minimum client**

  Use this explicit dependency boundary so tests do not patch globals:

  ```ts
  type CreateEventOptions = {
    apiBaseUrl: string;
    idempotencyKey: string;
    fetcher?: typeof fetch;
  };

  export async function createEvent(
    request: CreateEventRequest,
    options: CreateEventOptions,
  ): Promise<CreateEventResult>;
  ```

  Normalize `apiBaseUrl` by removing trailing slashes. Parse successful JSON only after `response.ok`; on errors, accept only the documented error fields and never include raw response text.

- [ ] **Step 4: Run focused tests and verify GREEN**

  Run: `npm test -- src/features/event-create/event-api.test.ts`

  Expected: PASS for success, structured error, and malformed upstream response cases.

- [ ] **Step 5: Document the public frontend setting and commit**

  Keep `VITE_API_BASE_URL=` in `.env.example`, adding one Japanese comment that it must contain the public `/api/v1` host without credentials. Then commit:

  ```bash
  git add .env.example src/features/event-create/event-api.ts src/features/event-create/event-api.test.ts
  git commit -m "feat: add typed event creation API client"
  ```

---

### Task 3: Basic information and candidate-time steps

**Files:**
- Create: `src/features/event-create/EventStepIndicator.tsx`
- Create: `src/features/event-create/BasicInformationStep.tsx`
- Create: `src/features/event-create/CandidateTimeStep.tsx`
- Create: `src/features/event-create/EventCreateFlow.tsx`
- Create: `src/features/event-create/EventCreateFlow.test.tsx`
- Modify: `src/pages/NewEventPage.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: the Task 1 draft helpers.
- Produces: an `EventCreateFlow` that advances from basic information to candidate time selection and back without losing values.

- [ ] **Step 1: Write failing user-flow tests for steps 1 and 2**

  Use `userEvent` against real components. Prove these observable behaviors:

  1. The placeholder message is gone and the three named steps render.
  2. Selecting `次へ` with empty required fields shows inline errors and remains on step 1.
  3. Valid basic information advances to `候補日時` without exposing the password in the document outside the password input.
  4. Adding `2026-11-10` creates one row, selecting `09:00〜09:30` sets `aria-pressed="true"`, keyboard activation toggles it, and duplicate dates are rejected.
  5. `戻る` preserves every basic field and selected candidate slot.

- [ ] **Step 2: Run the focused UI test and verify RED**

  Run: `npm test -- src/features/event-create/EventCreateFlow.test.tsx`

  Expected: FAIL because the flow and step components do not exist and the page still shows the P4 placeholder.

- [ ] **Step 3: Implement the step indicator and basic information form**

  Render semantic `<ol>` progress with `aria-current="step"`. Use visible labels exactly:

  - `イベント名`
  - `説明（任意）`
  - `主催者メールアドレス`
  - `管理用パスワード`
  - `回答時にメールで通知`

  Use `autoComplete="email"` and `autoComplete="new-password"`. Field errors use `aria-describedby` and an `aria-live="polite"` summary. Never mirror the password into confirmation text or debug output.

- [ ] **Step 4: Implement the accessible candidate-time grid**

  Generate exactly 36 columns from slot indexes 12–47. Each cell is a `<button type="button">` with an accessible name like `11月10日 09:00〜09:30 選択` and `aria-pressed`. Support click and pointer-drag painting using pointer capture; do not attach global mouse listeners. Use `Set` lookups for selected slots and functional state updates.

  Desktop: one horizontally scrollable table-like grid with dates as sticky first column.

  Mobile: each date remains a compact row within the same horizontal scroll area, with a sticky bottom action group. Do not create a second mobile component.

- [ ] **Step 5: Implement navigation and focused validation**

  `次へ` from step 1 calls `validateBasicInformation`. `次へ` from step 2 calls `validateCandidateDays`. The date input uses `min` equal to the local calendar date passed into `EventCreateFlow` as a prop for deterministic tests; production passes the current local date as `YYYY-MM-DD`.

- [ ] **Step 6: Run the focused test and verify GREEN**

  Run: `npm test -- src/features/event-create/EventCreateFlow.test.tsx`

  Expected: PASS for validation, navigation, pointer/keyboard selection, duplicate prevention, and preserved state.

- [ ] **Step 7: Run accessibility-oriented DOM checks and commit**

  Run: `npm test -- src/features/event-create/EventCreateFlow.test.tsx src/App.test.tsx`

  Expected: PASS; no `act(...)`, duplicate-key, or uncontrolled-input warnings.

  ```bash
  git add src/features/event-create src/pages/NewEventPage.tsx src/styles.css
  git commit -m "feat: build event creation time-grid workflow"
  ```

---

### Task 4: Confirmation, creation, and share-success state

**Files:**
- Create: `src/features/event-create/ConfirmationStep.tsx`
- Create: `src/features/event-create/EventCreationSuccess.tsx`
- Modify: `src/features/event-create/EventCreateFlow.tsx`
- Modify: `src/features/event-create/EventCreateFlow.test.tsx`
- Modify: `src/styles.css`
- Modify: `docs/phase-log.md`

**Interfaces:**
- Consumes: `createEvent()`, `toCreateEventRequest()`, and `buildEventUrls()`.
- Produces: a complete event creation flow ending in shareable participant and organizer URLs.

- [ ] **Step 1: Write failing confirmation and submission tests**

  Prove the following user-visible behavior:

  1. Step 3 shows title, description, organizer email, notification choice, selected dates, and selected time ranges, but never the administrator password.
  2. `日程調整を作成` sends one normalized request and disables navigation while pending.
  3. A failed request shows the safe API message and request ID, then retry reuses the same idempotency key.
  4. Returning to an earlier step and changing the draft discards the old idempotency key.
  5. Success shows `参加者用URL` and `主催者用URL`, copies each through an injected clipboard function, and warns that the organizer URL must be saved.

- [ ] **Step 2: Run the focused test and verify RED**

  Run: `npm test -- src/features/event-create/EventCreateFlow.test.tsx`

  Expected: FAIL because confirmation, API orchestration, and success state are missing.

- [ ] **Step 3: Implement confirmation without secret reflection**

  Convert selected consecutive slots into compact display ranges such as `09:00〜10:30`; separated ranges remain separate list items. The summary must use plain text values and never render `adminPassword`.

- [ ] **Step 4: Implement submission and idempotent retry**

  Add injectable dependencies to `EventCreateFlow`:

  ```ts
  type EventCreateFlowProps = {
    today: string;
    apiBaseUrl: string;
    location: BrowserLocation;
    createEventRequest?: typeof createEvent;
    createIdempotencyKey?: () => string;
    copyText?: (text: string) => Promise<void>;
  };
  ```

  Production defaults are `crypto.randomUUID()`, `navigator.clipboard.writeText`, and the real client. Keep the key in a ref for retries. Reset it only when a user returns to steps 1 or 2 and changes draft data.

- [ ] **Step 5: Implement success/share UI**

  Show the exact labels `参加者用URL`, `主催者用URL`, and `URLをコピー`. Copy feedback is an `aria-live="polite"` status, not a toast dependency. The primary completion action links to `#/` with `トップへ戻る`.

- [ ] **Step 6: Run focused tests and verify GREEN**

  Run: `npm test -- src/features/event-create/EventCreateFlow.test.tsx`

  Expected: PASS for summary secrecy, pending state, retry idempotency, reset-on-edit, URLs, and copy feedback.

- [ ] **Step 7: Run the full verification suite**

  Run:

  ```bash
  npm run lint
  npm test -- --run
  npm run build
  npm run build:function
  npm run test:function-bundle
  ```

  Expected: all commands exit 0; PostgreSQL tests may skip only when `DATABASE_URL` is absent.

- [ ] **Step 8: Perform two-round visual verification**

  Render at 1440×1000 and 390×844. Compare with `docs/design/kurukuru-event-creation-flow-concept.png` for: step hierarchy, white/navy/teal palette, grid prominence, control typography, work-surface borders/radii, horizontal overflow, sticky mobile action, and success URL hierarchy. Batch-fix the first findings, then confirm once. Record the browser or local-renderer limitation if no executable browser is available; do not claim screenshot verification that was not performed.

- [ ] **Step 9: Update the phase log and commit**

  Add a `2026-10-31 P4 イベント作成UI` entry with implemented states, tests, visual verification method, and remaining public response/admin-page gap.

  ```bash
  git add src/features/event-create src/styles.css docs/phase-log.md
  git commit -m "feat: complete event creation and sharing flow"
  ```
