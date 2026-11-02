# Participant Response UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the participant-facing event page that loads a public event, captures a complete four-level availability response, creates or edits that response, and matches the approved desktop and mobile concepts.

**Architecture:** Add one focused `event-response` feature with pure draft/aggregate helpers, a runtime-validated API client, a reusable availability grid, and a route-level page controller. The page uses the existing public event and response APIs; only the response ID and edit token are persisted in local storage, while public event data is always refreshed from the API.

**Tech Stack:** React 19, TypeScript, React Router, Zod, Vitest, Testing Library, existing CSS design tokens, Lucide icons.

**Spec:** `docs/design/direction.md`, `docs/design/kurukuru-desktop-concept.png`, `docs/design/kurukuru-mobile-concept.png`, and `docs/api-contract.md`.

## Global Constraints

- Preserve the approved white, deep-navy, teal, pale-aqua, and blue-gray design system exactly.
- Use symbols and text with color for `best | ok | maybe | ng`; never communicate availability with color alone.
- Show only event candidate slots as answerable; non-candidate grid cells remain disabled and blank.
- Initialize every candidate slot to `ng` so every POST/PATCH contains the complete candidate-slot set required by the API.
- Keep one responsive DOM. Desktop supports pointer drag; mobile exposes explicit `塗る` and `移動` modes and a sticky save action.
- Never display, log, or send the edit token except as the PATCH bearer token. Store it only under the event-scoped local-storage key.
- Treat malformed success or error responses as safe generic failures without exposing upstream response bodies.
- Do not change backend routes, database schema, or API contracts in this phase.

---

### Task 1: Response draft, grid model, and aggregate helpers

**Files:**
- Create: `src/features/event-response/response-model.ts`
- Create: `src/features/event-response/response-model.test.ts`

**Interfaces:**
- Consumes: `PublicEvent`, `PublicResponse`, and `AvailabilityMark` from `functions/events/service.ts`; slot formatting from `src/domain/slots.ts`.
- Produces: `ResponseDraft`, `createResponseDraft`, `createResponseRequest`, `responseForStoredEdit`, `buildGridModel`, `countAvailabilityBySlot`, `readStoredEdit`, and `writeStoredEdit`.

- [ ] **Step 1: Write failing model tests**

```ts
it('initializes every candidate slot as ng and serializes one sorted value per slot', () => {
  const draft = createResponseDraft(event);
  expect(Object.values(draft.availability)).toEqual(['ng', 'ng']);
  expect(createResponseRequest(event, { ...draft, displayName: ' 山田 ', comment: ' よろしく ' }))
    .toEqual({
      displayName: '山田',
      comment: 'よろしく',
      availability: [
        { candidateSlotId: slotA, mark: 'ng' },
        { candidateSlotId: slotB, mark: 'ng' },
      ],
    });
});

it('prefills a locally-owned public response and rejects malformed stored edit data', () => {
  expect(responseForStoredEdit(event, { responseId, editToken })).toMatchObject({
    displayName: '山田',
    availability: { [slotA]: 'best', [slotB]: 'ng' },
  });
  expect(readStoredEdit('{"responseId":"bad"}')).toBeNull();
});

it('builds a sorted sparse date/time grid and counts existing responses by mark', () => {
  expect(buildGridModel(event).dates).toEqual(['2026-11-10', '2026-11-11']);
  expect(countAvailabilityBySlot(event.responses, slotA)).toEqual({ best: 1, ok: 0, maybe: 0, ng: 1 });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- src/features/event-response/response-model.test.ts`

Expected: FAIL because `response-model.ts` does not exist.

- [ ] **Step 3: Implement minimal pure helpers**

```ts
export type ResponseDraft = {
  displayName: string;
  comment: string;
  availability: AvailabilityMap;
};

export function createResponseDraft(event: PublicEvent): ResponseDraft {
  return {
    displayName: '',
    comment: '',
    availability: Object.fromEntries(event.candidateSlots.map(({ id }) => [id, 'ng'])),
  };
}

export function createResponseRequest(event: PublicEvent, draft: ResponseDraft) {
  return {
    displayName: draft.displayName.trim(),
    comment: draft.comment.trim(),
    availability: [...event.candidateSlots]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id }) => ({ candidateSlotId: id, mark: draft.availability[id] ?? 'ng' })),
  };
}
```

Use Zod to parse the stored `{ responseId, editToken }` object. `writeStoredEdit` returns the JSON string instead of touching global storage so storage effects remain in the page controller.

- [ ] **Step 4: Run focused tests and full model tests**

Run: `npm test -- src/features/event-response/response-model.test.ts src/domain/availability.test.ts src/domain/slots.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/features/event-response/response-model.ts src/features/event-response/response-model.test.ts
git commit -m "feat: model participant responses"
```

### Task 2: Public event and response API client

**Files:**
- Create: `src/features/event-response/response-api.ts`
- Create: `src/features/event-response/response-api.test.ts`

**Interfaces:**
- Consumes: `PublicEvent` and the request returned by `createResponseRequest`.
- Produces: `getPublicEvent`, `createParticipantResponse`, `updateParticipantResponse`, and `ResponseApiError`.

- [ ] **Step 1: Write failing API tests**

```ts
it('loads and validates a public event', async () => {
  const event = await getPublicEvent(eventId, { apiBaseUrl: '/api/v1', fetcher });
  expect(event.id).toBe(eventId);
});

it('creates with an idempotency key and returns a validated edit token', async () => {
  const result = await createParticipantResponse(eventId, request, {
    apiBaseUrl: '/api/v1', idempotencyKey: 'response-key-0001', fetcher,
  });
  expect(result).toEqual({ response: publicResponse, editToken: 'opaque-edit-token' });
});

it('updates with a bearer token and never exposes invalid upstream bodies', async () => {
  await updateParticipantResponse(responseId, request, {
    apiBaseUrl: '/api/v1', editToken: 'opaque-edit-token', fetcher,
  });
  await expect(getPublicEvent(eventId, { apiBaseUrl: '/api/v1', fetcher: invalidFetcher }))
    .rejects.toMatchObject({ message: 'イベントを読み込めませんでした。時間をおいて再度お試しください。' });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/features/event-response/response-api.test.ts`

Expected: FAIL because the API client does not exist.

- [ ] **Step 3: Implement schemas and three requests**

```ts
export async function createParticipantResponse(
  eventId: string,
  request: ResponseRequest,
  options: CreateResponseOptions,
) {
  return requestJson(createResponseResultSchema, `${base(options.apiBaseUrl)}/events/${eventId}/responses`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': options.idempotencyKey },
    body: JSON.stringify(request),
  }, options.fetcher);
}
```

Use the same `PublicEvent`/`PublicResponse` runtime schema for GET, POST, and PATCH. Parse only the documented API error shape; otherwise return fixed Japanese error messages.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/features/event-response/response-api.test.ts src/features/event-create/event-api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/features/event-response/response-api.ts src/features/event-response/response-api.test.ts
git commit -m "feat: add participant response client"
```

### Task 3: Availability grid and participant form

**Files:**
- Create: `src/features/event-response/AvailabilityResponseGrid.tsx`
- Create: `src/features/event-response/AvailabilityResponseGrid.test.tsx`
- Create: `src/features/event-response/ParticipantResponseForm.tsx`

**Interfaces:**
- Consumes: `PublicEvent`, `ResponseDraft`, `AvailabilityMark`, `applyPaint`, `buildGridModel`, and `countAvailabilityBySlot`.
- Produces: accessible pointer/keyboard availability editing and a controlled name/comment form with save callbacks.

- [ ] **Step 1: Write failing interaction tests**

```tsx
it('shows only candidate cells as answerable and paints by click and drag', async () => {
  render(<Harness event={event} />);
  expect(screen.getByRole('button', { name: /11月10日.*09:00.*不可/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /11月10日.*09:30/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '希望' }));
  await user.click(screen.getByRole('button', { name: /11月10日.*09:00.*不可/ }));
  expect(screen.getByRole('button', { name: /11月10日.*09:00.*希望/ })).toHaveTextContent('◎');
});

it('switches between paint and move modes and preserves keyboard toggling', async () => {
  render(<Harness event={event} />);
  await user.click(screen.getByRole('button', { name: '移動（スクロール）' }));
  expect(screen.getByRole('region', { name: '回答時間表' })).not.toHaveClass('is-painting');
  await user.keyboard('{Tab}{Enter}');
});

it('renders response counts and disables save for a closed event', () => {
  render(<ParticipantResponseForm event={{ ...event, status: 'closed' }} {...props} />);
  expect(screen.getByRole('button', { name: '回答を保存' })).toBeDisabled();
  expect(screen.getByText('回答受付は終了しています')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/features/event-response/AvailabilityResponseGrid.test.tsx`

Expected: FAIL because the grid and form do not exist.

- [ ] **Step 3: Implement one responsive grid and controlled form**

Render dates as rows and the event's minimum-to-maximum slot range as columns. Non-candidates are plain disabled cells. Candidate cells are buttons carrying `data-slot-id`; pointer painting uses pointer capture plus `elementFromPoint`, and keyboard/assistive clicks update one cell. The four mark controls use the approved symbol, label, semantic class, and `aria-pressed` state.

The form includes name, collapsible comment on mobile through responsive CSS, status/finalization copy, existing response counts, live save status, and a sticky mobile save bar. Name validation requires 1–80 trimmed characters; comment permits 0–1000.

- [ ] **Step 4: Run focused UI tests**

Run: `npm test -- src/features/event-response/AvailabilityResponseGrid.test.tsx src/features/event-create/EventCreateFlow.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add src/features/event-response/AvailabilityResponseGrid.tsx src/features/event-response/AvailabilityResponseGrid.test.tsx src/features/event-response/ParticipantResponseForm.tsx
git commit -m "feat: build participant availability grid"
```

### Task 4: Route controller, create/edit persistence, and responsive styling

**Files:**
- Create: `src/pages/ParticipantEventPage.tsx`
- Create: `src/pages/ParticipantEventPage.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `src/styles.css`
- Modify: `docs/phase-log.md`

**Interfaces:**
- Consumes: all Task 1–3 exports, route `eventId`, `VITE_API_BASE_URL`, `window.localStorage`, and `window.crypto.randomUUID`.
- Produces: working `#/events/:eventId` participant route with load/error/not-found, create, idempotent retry, local edit ownership, PATCH editing, refresh, and share behavior.

- [ ] **Step 1: Write failing page-flow tests**

```tsx
it('loads an event and creates a response with an idempotency key', async () => {
  renderPage();
  expect(await screen.findByRole('heading', { name: event.title })).toBeInTheDocument();
  await user.type(screen.getByLabelText('お名前'), '山田 太郎');
  await user.click(screen.getByRole('button', { name: '回答を保存' }));
  expect(createParticipantResponse).toHaveBeenCalledWith(event.id, expect.anything(),
    expect.objectContaining({ idempotencyKey: expect.any(String) }));
  expect(screen.getByText('回答を保存しました')).toBeInTheDocument();
});

it('keeps the same idempotency key after failure and stores the edit token only after success', async () => {
  renderPage({ createResults: [new ResponseApiError(503), createResult] });
  await submitTwice();
  expect(createKeys()).toEqual([createKeys()[0], createKeys()[0]]);
  expect(localStorage.getItem(storageKey(event.id))).not.toContain(event.title);
});

it('prefills and patches a locally-owned response without displaying its token', async () => {
  localStorage.setItem(storageKey(event.id), writeStoredEdit({ responseId, editToken }));
  renderPage();
  expect(await screen.findByDisplayValue('山田 太郎')).toBeInTheDocument();
  expect(screen.queryByText(editToken)).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '回答を更新' }));
  expect(updateParticipantResponse).toHaveBeenCalledWith(responseId, expect.anything(),
    expect.objectContaining({ editToken }));
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/pages/ParticipantEventPage.test.tsx src/App.test.tsx`

Expected: FAIL because the route and page do not exist.

- [ ] **Step 3: Implement route and controller**

```tsx
<Route path="/events/:eventId" element={
  <ParticipantEventPage apiBaseUrl={import.meta.env.VITE_API_BASE_URL || '/api/v1'} />
} />
```

On load, fetch the public event, parse the stored edit object, and prefill only when its response ID exists in `event.responses`. Generate the POST idempotency key once per unsaved draft and retain it after retryable failures. After create, store `{ responseId, editToken }`, switch the button to `回答を更新`, and refresh the public event. PATCH never changes local edit ownership.

- [ ] **Step 4: Implement styles from the accepted concepts**

Add `participant-*` and `response-*` classes only. Match desktop 1440×1000 and mobile 390×844 anatomy: event summary, pale-aqua identity strip, four mark controls, paint/move toggle, sticky first column, horizontally scrollable grid, count rail, live save message, and mobile fixed action. Reuse existing CSS variables and do not add gradients, nested cards, or new decorative copy.

- [ ] **Step 5: Run full verification**

Run:

```bash
npm test
npm run lint
npm run build
npm run build:function
npm run test:function-bundle
git diff --check
```

Expected: all commands exit 0; local PostgreSQL integration tests may skip only when `DATABASE_URL` is absent.

- [ ] **Step 6: Perform visual verification**

Start the built app, load a deterministic mocked event at 1440×1000 and 390×844, capture both states, and inspect the captures and the two accepted concepts with `view_image`. Record at least copy, layout, typography, palette, grid anatomy, controls, mobile overflow, and sticky action in a fidelity ledger. Fix material mismatches and repeat once.

- [ ] **Step 7: Update progress log and commit**

```bash
git add src/App.tsx src/App.test.tsx src/pages/ParticipantEventPage.tsx src/pages/ParticipantEventPage.test.tsx src/styles.css docs/phase-log.md
git commit -m "feat: complete participant response flow"
```
