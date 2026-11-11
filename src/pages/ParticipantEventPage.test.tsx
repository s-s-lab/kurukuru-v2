import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ParticipantEventPage } from './ParticipantEventPage';

const eventId = '11111111-1111-4111-8111-111111111111';
const responseId = '22222222-2222-4222-8222-222222222222';
const slotId = '33333333-3333-4333-8333-333333333333';
const editToken = 'opaque-edit-token-value';
const response = {
  id: responseId,
  displayName: '山田 太郎',
  comment: '',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  availability: [{ candidateSlotId: slotId, mark: 'ok' as const }],
};
const event = {
  id: eventId,
  title: '11月のプロジェクト定例',
  description: '都合のよい日時を教えてください。',
  duration: '1時間程度',
  status: 'open' as const,
  finalization: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  candidateSlots: [{ id: slotId, date: '2026-11-10', slotIndex: 18 }],
  responses: [response],
};

function renderPage(fetcher: typeof fetch) {
  return render(<MemoryRouter initialEntries={[`/events/${eventId}`]}>
    <Routes><Route path="/events/:eventId" element={
      <ParticipantEventPage apiBaseUrl="https://api.example.test/api/v1" fetcher={fetcher} />
    } /></Routes>
  </MemoryRouter>);
}

describe('participant event page', () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it('loads an event and creates a response with an idempotency key', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetcher: typeof fetch = async (input, init) => {
      calls.push([input, init]);
      if (!init?.method) return Response.json({ ...event, responses: [] });
      return Response.json({ response, editToken }, { status: 201 });
    };
    const user = userEvent.setup();
    renderPage(fetcher);

    expect(await screen.findByRole('heading', { name: event.title })).toBeInTheDocument();
    expect(screen.getByText('所要時間：1時間程度')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回答を追加' }));
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎');
    await user.click(screen.getByRole('button', { name: '回答を保存' }));

    expect(await screen.findAllByText('回答を保存しました')).not.toHaveLength(0);
    const post = calls.find(([, init]) => init?.method === 'POST');
    expect(post?.[1]?.headers).toEqual(expect.objectContaining({
      'idempotency-key': expect.any(String),
    }));
    expect(document.body.textContent).not.toContain(editToken);
  });

  it('keeps the same idempotency key after a retryable failure', async () => {
    const keys: string[] = [];
    let attempt = 0;
    const fetcher: typeof fetch = async (_input, init) => {
      if (!init?.method) return Response.json({ ...event, responses: [] });
      keys.push((init.headers as Record<string, string>)['idempotency-key']);
      attempt += 1;
      return attempt === 1
        ? Response.json({ code: 'SERVICE_UNAVAILABLE', message: '一時的に利用できません。', requestId: 'r1' }, { status: 503 })
        : Response.json({ response, editToken }, { status: 201 });
    };
    const user = userEvent.setup();
    renderPage(fetcher);
    await screen.findByRole('heading', { name: event.title });
    await user.click(screen.getByRole('button', { name: '回答を追加' }));
    await user.type(screen.getByLabelText(/お名前/), '山田 太郎');
    await user.click(screen.getByRole('button', { name: '回答を保存' }));
    expect(await screen.findAllByText('一時的に利用できません。')).not.toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '回答を保存' }));
    expect(await screen.findAllByText('回答を保存しました')).not.toHaveLength(0);
    expect(keys).toEqual([keys[0], keys[0]]);
  });

  it('回答者名から別ブラウザでも回答を開き、Bearerなしの公開APIで更新する', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (!init?.method) return Response.json(event);
      return Response.json({ response: { ...response, comment: '更新' } });
    });
    const user = userEvent.setup();
    renderPage(fetcher);

    expect(await screen.findByRole('button', { name: '山田 太郎の回答を編集' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '山田 太郎の回答を編集' }));
    expect(await screen.findByDisplayValue('山田 太郎')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '回答を更新' }));
    expect(await screen.findAllByText('回答を更新しました')).not.toHaveLength(0);
    expect(fetcher).toHaveBeenCalledWith(
      `https://api.example.test/api/v1/events/${eventId}/responses/${responseId}`,
      expect.objectContaining({
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });
});
