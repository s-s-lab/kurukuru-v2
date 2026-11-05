const STORAGE_KEY = 'kurukuru:created-events';
const HISTORY_LIMIT = 10;

export type CreatedEventHistoryItem = {
  eventId: string;
  title: string;
  createdAt: string;
  participantUrl: string;
  organizerUrl: string;
};

function isHistoryItem(value: unknown): value is CreatedEventHistoryItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return ['eventId', 'title', 'createdAt', 'participantUrl', 'organizerUrl']
    .every((key) => typeof item[key] === 'string');
}

export function readCreatedEventHistory(): CreatedEventHistoryItem[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isHistoryItem).slice(0, HISTORY_LIMIT) : [];
  } catch {
    return [];
  }
}

export function saveCreatedEventHistory(item: CreatedEventHistoryItem) {
  try {
    const history = readCreatedEventHistory().filter(({ eventId }) => eventId !== item.eventId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([item, ...history].slice(0, HISTORY_LIMIT)));
  } catch {
    // The scheduling flow must keep working when browser storage is unavailable.
  }
}
