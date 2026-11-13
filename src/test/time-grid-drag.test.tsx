import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PublicEvent } from '../../functions/events/service';
import { CandidateTimeStep } from '../features/event-create/CandidateTimeStep';
import type { CandidateDayDraft } from '../features/event-create/event-draft';
import { AvailabilityResponseGrid } from '../features/event-response/AvailabilityResponseGrid';
import type { AvailabilityMap } from '../domain/availability';

const date = '2026-11-10';
const event: PublicEvent = {
  id: 'event-id', title: '時間表テスト', description: '', duration: '1時間程度',
  status: 'open', finalization: null, createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z', responses: [],
  candidateSlots: [18, 19, 20, 21, 22].map((slotIndex) => ({ id: `slot-${slotIndex}`, date, slotIndex })),
};

function CandidateHarness({ selected = false, disabled = false, multipleDates = false, onPainted }: {
  selected?: boolean; disabled?: boolean; multipleDates?: boolean; onPainted?: (slot: number) => void;
}) {
  const [days, setDays] = useState<CandidateDayDraft[]>([
    { date, slotIndexes: selected ? [18, 19, 20, 21, 22] : [] },
    ...(multipleDates ? [{ date: '2026-11-11', slotIndexes: [] }] : []),
  ]);
  return <CandidateTimeStep days={days} currentDate={date} errors={{}} disabled={disabled}
    onToggleDate={() => {}} onRemoveDate={() => {}} onApplyRange={() => {}} onClearAllSlots={() => {}}
    onToggleSlot={() => {}} onPaintSlot={(cellDate, slot, selected_) => {
      onPainted?.(slot);
      setDays((current) => current.map((day) => (
      day.date === cellDate ? { ...day, slotIndexes: selected_
        ? [...new Set([...day.slotIndexes, slot])]
        : day.slotIndexes.filter((value) => value !== slot) } : day
    )));
    }} />;
}

function ResponseHarness({ sparse = false }) {
  const [availability, setAvailability] = useState<AvailabilityMap>({});
  const currentEvent = sparse ? { ...event, candidateSlots: event.candidateSlots.filter((slot) => slot.slotIndex !== 20) } : event;
  return <AvailabilityResponseGrid event={currentEvent} availability={availability} selectedMark="best"
    onSelectedMarkChange={() => {}} onPaint={(ids, mark) => setAvailability((current) => ({
      ...current, ...Object.fromEntries(ids.map((id) => [id, mark])),
    }))} />;
}

const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');

// JSDOM has no layout or hit-testing. Model real 18px buttons separated by 1px borders.
function layout(selector: string) {
  const cells = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const rects = new Map(cells.map((cell) => {
    const slot = Number(cell.dataset.slot ?? cell.dataset.slotId?.replace('slot-', ''));
    const rect = new DOMRect(100 + (slot - 18) * 19, cell.dataset.date === '2026-11-11' ? 160 : 100, 18, 34);
    vi.spyOn(cell, 'getBoundingClientRect').mockReturnValue(rect);
    return [cell, rect] as const;
  }));
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: (x: number, y: number) => {
    for (const [cell, rect] of rects) {
      if (x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return cell;
    }
    return null;
  } });
  return cells;
}

function pointer(target: Element, type: string, x: number, pointerId = 1, y = 117) {
  const event_ = new MouseEvent(type, { bubbles: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x, clientY: y });
  Object.defineProperty(event_, 'pointerId', { value: pointerId });
  fireEvent(target, event_);
}

function candidate(slot: number) {
  return document.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
}

function response(slot: number) {
  return document.querySelector<HTMLElement>(`[data-slot-id="slot-${slot}"]`)!;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
  else Reflect.deleteProperty(document, 'elementFromPoint');
});

describe('sparse time-grid pointer gestures', () => {
  it.each([
    { selected: false, reverse: false }, { selected: false, reverse: true },
    { selected: true, reverse: false }, { selected: true, reverse: true },
  ])('paints every crossed candidate cell on a sparse jump ($selected, reverse: $reverse)', ({ selected, reverse }) => {
    render(<CandidateHarness selected={selected} />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(reverse ? 22 : 18), 'pointerdown', reverse ? 185 : 109);
    pointer(region, 'pointermove', reverse ? 109 : 185);
    expect(candidate(18)).toHaveAttribute('aria-pressed', String(!selected));
    expect(candidate(19)).toHaveAttribute('aria-pressed', String(!selected));
    expect(candidate(20)).toHaveAttribute('aria-pressed', String(!selected));
    expect(candidate(21)).toHaveAttribute('aria-pressed', String(!selected));
    expect(candidate(22)).toHaveAttribute('aria-pressed', String(!selected));
  });

  it('follows a diagonal path including a clipped cell corner without filling its bounding rectangle', () => {
    render(<CandidateHarness multipleDates />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(18), 'pointerdown', 109);
    pointer(region, 'pointermove', 147, 1, 177);
    const secondRow = (slot: number) => document.querySelector(`[data-date="2026-11-11"][data-slot="${slot}"]`)!;
    expect(candidate(19)).toHaveAttribute('aria-pressed', 'true');
    expect(secondRow(19)).toHaveAttribute('aria-pressed', 'true');
    expect(secondRow(20)).toHaveAttribute('aria-pressed', 'true');
    expect(candidate(20)).toHaveAttribute('aria-pressed', 'false');
    expect(secondRow(18)).toHaveAttribute('aria-pressed', 'false');
  });

  it.each([false, true])('paints a response jump and skips unavailable time cells (reverse: %s)', (reverse) => {
    render(<ResponseHarness sparse />);
    layout('[data-slot-id]');
    const region = screen.getByRole('region', { name: '回答時間表' });
    pointer(response(reverse ? 22 : 18), 'pointerdown', reverse ? 185 : 109);
    pointer(region, 'pointermove', reverse ? 109 : 185);
    expect(response(22)).toHaveTextContent('◎');
    expect(response(21)).toHaveTextContent('◎');
    expect(response(19)).toHaveTextContent('◎');
    expect(response(18)).toHaveTextContent('◎');
    expect(document.querySelector('[data-slot-id="slot-20"]')).toBeNull();
  });

  it.each(['candidate', 'response'])('paints the final pointerup segment in the %s grid', (grid) => {
    render(grid === 'candidate' ? <CandidateHarness /> : <ResponseHarness />);
    layout(grid === 'candidate' ? '[data-slot]' : '[data-slot-id]');
    const start = grid === 'candidate' ? candidate(18) : response(18);
    const region = screen.getByRole('region', { name: grid === 'candidate' ? '時間表の横スクロール' : '回答時間表' });
    pointer(start, 'pointerdown', 109);
    pointer(region, 'pointerup', 185);
    if (grid === 'candidate') {
      expect(candidate(19)).toHaveAttribute('aria-pressed', 'true');
      expect(candidate(22)).toHaveAttribute('aria-pressed', 'true');
    } else {
      expect(response(19)).toHaveTextContent('◎');
      expect(response(22)).toHaveTextContent('◎');
    }
  });

  it.each(['pointercancel', 'lostpointercapture'])('stops painting after %s and ignores another pointer', (ending) => {
    render(<CandidateHarness />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(18), 'pointerdown', 109);
    pointer(region, 'pointermove', 185, 2);
    expect(candidate(22)).toHaveAttribute('aria-pressed', 'false');
    pointer(region, ending, 185);
    pointer(region, 'pointermove', 185);
    expect(candidate(19)).toHaveAttribute('aria-pressed', 'false');
    expect(candidate(22)).toHaveAttribute('aria-pressed', 'false');
  });

  it('tracks pointer positions outside eligible cells without drawing a stale chord on re-entry', () => {
    render(<CandidateHarness />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(18), 'pointerdown', 109);
    pointer(region, 'pointermove', 109, 1, 70);
    pointer(region, 'pointermove', 185, 1, 70);
    pointer(region, 'pointermove', 185);
    expect(candidate(22)).toHaveAttribute('aria-pressed', 'true');
    expect(candidate(19)).toHaveAttribute('aria-pressed', 'false');
    expect(candidate(20)).toHaveAttribute('aria-pressed', 'false');
    expect(candidate(21)).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not start candidate painting while disabled', () => {
    render(<CandidateHarness disabled />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(18), 'pointerdown', 109);
    pointer(region, 'pointermove', 185);
    expect(candidate(18)).toHaveAttribute('aria-pressed', 'false');
    expect(candidate(19)).toHaveAttribute('aria-pressed', 'false');
    expect(candidate(22)).toHaveAttribute('aria-pressed', 'false');
  });

  it.each(['candidate', 'response'])('does not paint a sparse gesture in %s move mode', (grid) => {
    render(grid === 'candidate' ? <CandidateHarness /> : <ResponseHarness />);
    layout(grid === 'candidate' ? '[data-slot]' : '[data-slot-id]');
    fireEvent.click(screen.getByRole('button', { name: grid === 'candidate' ? '移動' : '移動（スクロール）' }));
    const start = grid === 'candidate' ? candidate(18) : response(18);
    const region = screen.getByRole('region', { name: grid === 'candidate' ? '時間表の横スクロール' : '回答時間表' });
    pointer(start, 'pointerdown', 109);
    pointer(region, 'pointermove', 185);
    pointer(region, 'pointerup', 185);
    if (grid === 'candidate') expect(candidate(22)).toHaveAttribute('aria-pressed', 'false');
    else expect(response(22)).toHaveTextContent('×');
  });


  it('paints each candidate at most once when a gesture doubles back', () => {
    const painted = vi.fn();
    render(<CandidateHarness onPainted={painted} />);
    layout('[data-slot]');
    const region = screen.getByRole('region', { name: '時間表の横スクロール' });
    pointer(candidate(18), 'pointerdown', 109);
    pointer(region, 'pointermove', 185);
    pointer(region, 'pointermove', 109);
    pointer(region, 'pointerup', 185);
    expect(painted.mock.calls.map(([slot]) => slot)).toEqual([18, 19, 20, 21, 22]);
  });

  it.each(['candidate', 'response'])('measures the %s grid only once per gesture', (grid) => {
    render(grid === 'candidate' ? <CandidateHarness /> : <ResponseHarness />);
    const cells = layout(grid === 'candidate' ? '[data-slot]' : '[data-slot-id]');
    const start = grid === 'candidate' ? candidate(18) : response(18);
    const region = screen.getByRole('region', { name: grid === 'candidate' ? '時間表の横スクロール' : '回答時間表' });
    const measurementCount = () => cells.reduce((count, cell) => (
      count + vi.mocked(cell.getBoundingClientRect).mock.calls.length
    ), 0);

    pointer(start, 'pointerdown', 109);
    const afterStart = measurementCount();
    expect(afterStart).toBeGreaterThan(0);
    pointer(region, 'pointermove', 147);
    pointer(region, 'pointermove', 185);
    pointer(region, 'pointerup', 185);

    expect(measurementCount()).toBe(afterStart);
  });

  it('finds a partially visible response cell beyond a sticky header', () => {
    render(<ResponseHarness />);
    layout('[data-slot-id]');
    const header = document.querySelector('th')!;
    vi.spyOn(header, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 100, 116, 34));
    const hitTest = document.elementFromPoint.bind(document);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true,
      value: (x: number, y: number) => x < 116 ? header : hitTest(x, y) });
    const region = screen.getByRole('region', { name: '回答時間表' });
    pointer(response(22), 'pointerdown', 185);
    pointer(region, 'pointermove', 109);
    expect(response(18)).toHaveTextContent('◎');
    expect(response(19)).toHaveTextContent('◎');
  });

});
