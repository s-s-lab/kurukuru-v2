import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { CandidateDayDraft } from './event-draft';

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

type Month = { year: number; month: number };

function parseMonth(date: string): Month {
  const [year, month] = date.split('-').map(Number);
  return { year, month: month - 1 };
}

function addMonths(value: Month, amount: number): Month {
  const date = new Date(Date.UTC(value.year, value.month + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function formatIsoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateToIso(value: Date) {
  return formatIsoDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function addDays(value: string, amount: number) {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return dateToIso(date);
}

function addMonthsToDate(value: string, amount: number) {
  const date = parseIsoDate(value);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return dateToIso(target);
}

function monthIndex(value: Month) {
  return value.year * 12 + value.month;
}

function CalendarMonth({ month, currentDate, focusedDate, selectedDates, candidateLimitReached,
  onFocusDate, onDateKeyDown, onToggleDate }: {
  month: Month;
  currentDate: string;
  focusedDate: string;
  selectedDates: ReadonlySet<string>;
  candidateLimitReached: boolean;
  onFocusDate: (date: string) => void;
  onDateKeyDown: (event: KeyboardEvent<HTMLButtonElement>, date: string) => void;
  onToggleDate: (date: string) => void;
}) {
  const daysInMonth = new Date(Date.UTC(month.year, month.month + 1, 0)).getUTCDate();
  const firstWeekday = new Date(Date.UTC(month.year, month.month, 1)).getUTCDay();
  const title = `${month.year}年${month.month + 1}月`;
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const weeks = Array.from({ length: cellCount }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day >= 1 && day <= daysInMonth ? day : null;
  }).reduce<Array<Array<number | null>>>((rows, day, index) => {
    if (index % 7 === 0) rows.push([]);
    rows.at(-1)?.push(day);
    return rows;
  }, []);

  return <section className="candidate-calendar-month" role="group" aria-label={`${title}のカレンダー`}>
    <h3>{title}</h3>
    <div className="candidate-calendar-grid" role="grid" aria-label={title}>
      <div className="candidate-calendar-weekdays" role="row">
        {WEEKDAYS.map((weekday) => <span role="columnheader" key={weekday}>{weekday}</span>)}
      </div>
      {weeks.map((week, weekIndex) => <div className="candidate-calendar-days" role="row" key={weekIndex}>
        {week.map((day, dayIndex) => {
          if (day === null) return <span role="gridcell" className="candidate-calendar-blank" key={`blank-${dayIndex}`} />;
          const date = formatIsoDate(month.year, month.month, day);
          const selected = selectedDates.has(date);
          const disabled = date < currentDate;
          const limitBlocked = candidateLimitReached && !selected;
          const action = selected ? '候補日から削除' : '候補日に追加';
          return <span role="gridcell" key={date}>
            <button type="button" disabled={disabled} aria-disabled={limitBlocked || undefined} aria-pressed={selected}
              aria-label={`${month.year}年${month.month + 1}月${day}日を${action}`}
              data-calendar-date={date} tabIndex={date === focusedDate ? 0 : -1}
              className={date === currentDate ? 'is-today' : undefined}
              onFocus={() => onFocusDate(date)} onKeyDown={(event) => onDateKeyDown(event, date)}
              onClick={() => { if (!limitBlocked) onToggleDate(date); }}>
              <span>{day}</span>
            </button>
          </span>;
        })}
      </div>)}
    </div>
  </section>;
}

export function CandidateDateCalendar({ days, currentDate, onToggleDate }: {
  days: CandidateDayDraft[];
  currentDate: string;
  onToggleDate: (date: string) => void;
}) {
  const currentMonth = useMemo(() => parseMonth(currentDate), [currentDate]);
  const [firstMonth, setFirstMonth] = useState(currentMonth);
  const [focusedDate, setFocusedDate] = useState(currentDate);
  const calendar = useRef<HTMLDivElement>(null);
  const focusRequested = useRef(false);
  const selectedDates = useMemo(() => new Set(days.map(({ date }) => date)), [days]);
  const visibleMonths = [firstMonth, addMonths(firstMonth, 1)];

  useEffect(() => {
    if (!focusRequested.current) return;
    calendar.current?.querySelector<HTMLButtonElement>(`[data-calendar-date="${focusedDate}"]`)?.focus();
    focusRequested.current = false;
  }, [firstMonth, focusedDate]);

  function showAndFocus(date: string) {
    const targetMonth = parseMonth(date);
    const targetIndex = monthIndex(targetMonth);
    const firstIndex = monthIndex(firstMonth);
    if (targetIndex < firstIndex || targetIndex > firstIndex + 1) setFirstMonth(targetMonth);
    focusRequested.current = true;
    setFocusedDate(date < currentDate ? currentDate : date);
  }

  function moveByMonth(amount: number) {
    const nextMonth = addMonths(firstMonth, amount);
    setFirstMonth(nextMonth);
    const firstDate = formatIsoDate(nextMonth.year, nextMonth.month, 1);
    setFocusedDate(firstDate < currentDate ? currentDate : firstDate);
  }

  function handleDateKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let target: string | undefined;
    if (event.key === 'ArrowLeft') target = addDays(date, -1);
    if (event.key === 'ArrowRight') target = addDays(date, 1);
    if (event.key === 'ArrowUp') target = addDays(date, -7);
    if (event.key === 'ArrowDown') target = addDays(date, 7);
    if (event.key === 'Home') target = addDays(date, -parseIsoDate(date).getUTCDay());
    if (event.key === 'End') target = addDays(date, 6 - parseIsoDate(date).getUTCDay());
    if (event.key === 'PageUp') target = addMonthsToDate(date, -1);
    if (event.key === 'PageDown') target = addMonthsToDate(date, 1);
    if (!target) return;
    event.preventDefault();
    showAndFocus(target);
  }

  return <div className="candidate-calendar" ref={calendar}>
    <div className="candidate-calendar-heading">
      <div>
        <h3>候補日を選ぶ</h3>
        <p>日付を押すとすぐに追加されます。もう一度押すと解除できます。</p>
      </div>
      <div className="candidate-calendar-navigation" aria-label="カレンダーの月移動">
        <button type="button" aria-label="前の月へ" onClick={() => moveByMonth(-1)}>
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={() => { setFirstMonth(currentMonth); setFocusedDate(currentDate); }}>今月</button>
        <button type="button" aria-label="次の月へ" onClick={() => moveByMonth(1)}>
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
    <div className="candidate-calendar-months">
      {visibleMonths.map((month) => <CalendarMonth key={`${month.year}-${month.month}`} month={month}
        currentDate={currentDate} focusedDate={focusedDate} selectedDates={selectedDates}
        candidateLimitReached={days.length >= 20} onFocusDate={setFocusedDate} onDateKeyDown={handleDateKeyDown}
        onToggleDate={onToggleDate} />)}
    </div>
    <p className="candidate-calendar-count" aria-live="polite">選択中：{days.length}日 / 20日まで</p>
  </div>;
}
