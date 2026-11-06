import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';

import type { AvailabilityMark, PublicEvent } from '../../functions/events/service';
import { applyPaint } from '../domain/availability';
import { ParticipantResponseForm } from '../features/event-response/ParticipantResponseForm';
import {
  createParticipantResponse,
  getPublicEvent,
  ResponseApiError,
  updatePublicParticipantResponse,
} from '../features/event-response/response-api';
import {
  createResponseDraft,
  createResponseRequest,
  responseForEdit,
  type ResponseDraft,
} from '../features/event-response/response-model';

type Props = {
  apiBaseUrl: string;
  fetcher?: typeof fetch;
};

function newIdempotencyKey() {
  return `response-${globalThis.crypto.randomUUID()}`;
}

function replaceResponse(event: PublicEvent, response: PublicEvent['responses'][number]): PublicEvent {
  const exists = event.responses.some(({ id }) => id === response.id);
  return {
    ...event,
    responses: exists
      ? event.responses.map((current) => current.id === response.id ? response : current)
      : [...event.responses, response],
  };
}

export function ParticipantEventPage({ apiBaseUrl, fetcher }: Props) {
  const { eventId = '' } = useParams();
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [draft, setDraft] = useState<ResponseDraft | null>(null);
  const [editingResponseId, setEditingResponseId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedMark, setSelectedMark] = useState<AvailabilityMark>('best');
  const [loadError, setLoadError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());
  const candidateSlotIds = useMemo(
    () => new Set(event?.candidateSlots.map(({ id }) => id) ?? []),
    [event],
  );
  const closeEditor = useCallback(() => setEditorOpen(false), []);

  useEffect(() => {
    let active = true;
    getPublicEvent(eventId, { apiBaseUrl, fetcher }).then((loaded) => {
      if (!active) return;
      setEvent(loaded);
      setLoadError('');
      setDraft(createResponseDraft(loaded));
    }).catch((error: unknown) => {
      if (!active) return;
      setLoadError(error instanceof Error ? error.message : 'イベントを読み込めませんでした。');
    });
    return () => { active = false; };
  }, [apiBaseUrl, eventId, fetcher]);

  async function submit() {
    if (!event || !draft || isSubmitting) return;
    const request = createResponseRequest(event, draft);
    if (!request.displayName || request.displayName.length > 80 || request.comment.length > 1000) {
      setSaveMessage('お名前とコメントの入力内容を確認してください。');
      return;
    }

    setIsSubmitting(true);
    setSaveMessage('');
    try {
      if (editingResponseId) {
        const result = await updatePublicParticipantResponse(event.id, editingResponseId, request, {
          apiBaseUrl,
          fetcher,
        });
        setEvent((current) => current ? replaceResponse(current, result.response) : current);
        setSaveMessage('回答を更新しました');
      } else {
        const result = await createParticipantResponse(event.id, request, {
          apiBaseUrl,
          idempotencyKey: idempotencyKey.current,
          fetcher,
        });
        setSaveMessage('回答を保存しました');
        setEvent((current) => current ? replaceResponse(current, result.response) : current);
        idempotencyKey.current = newIdempotencyKey();
      }
      setEditorOpen(false);
    } catch (error) {
      setSaveMessage(error instanceof ResponseApiError
        ? error.message
        : '回答を保存できませんでした。時間をおいて再度お試しください。');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: event?.title, url: window.location.href });
      else await navigator.clipboard.writeText(window.location.href);
      setSaveMessage('参加者用URLを共有できます');
    } catch {
      setSaveMessage('URLを共有できませんでした。ブラウザのアドレスをコピーしてください。');
    }
  }

  if (loadError) return <main className="shell participant-state"><h1>イベントを表示できません</h1><p>{loadError}</p></main>;
  if (!event || !draft) return <main className="shell participant-state"><p>イベントを読み込んでいます…</p></main>;

  function openNewResponse() {
    if (!event) return;
    setEditingResponseId(null);
    setDraft(createResponseDraft(event));
    setSaveMessage('');
    setEditorOpen(true);
  }

  function openExistingResponse(responseId: string) {
    if (!event || event.status === 'closed') return;
    const nextDraft = responseForEdit(event, responseId);
    if (!nextDraft) return;
    setEditingResponseId(responseId);
    setDraft(nextDraft);
    setSaveMessage('');
    setEditorOpen(true);
  }

  return <ParticipantResponseForm event={event} draft={draft}
    selectedMark={selectedMark} onSelectedMarkChange={setSelectedMark}
    onDraftChange={(field, value) => setDraft((current) => current ? { ...current, [field]: value } : current)}
    onPaint={(slotIds, mark) => setDraft((current) => current ? {
      ...current,
      availability: applyPaint(current.availability, slotIds, mark, candidateSlotIds),
    } : current)}
    onSubmit={submit} onShare={share} isSubmitting={isSubmitting}
    editorOpen={editorOpen} isEditing={Boolean(editingResponseId)}
    onOpenNew={openNewResponse} onEditResponse={openExistingResponse}
    onCloseEditor={closeEditor} saveMessage={saveMessage} />;
}
