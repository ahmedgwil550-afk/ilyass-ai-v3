export const HISTORY_KEY = "ilyass-history";
export const MAX_HISTORY_ENTRIES = 50;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface ImageBearingMessage {
  imagePreview?: string;
  imagePreviews?: string[];
}

export interface HistoryEntryLike {
  id: string;
  messages: ImageBearingMessage[];
}

function withoutImages<T extends HistoryEntryLike>(entry: T): T {
  return {
    ...entry,
    messages: entry.messages.map(({ imagePreview: _single, imagePreviews: _many, ...rest }) => rest),
  } as unknown as T;
}

/**
 * Saves a conversation to the history list without ever throwing. Photos make
 * the stored JSON large, and localStorage is only a few megabytes, so a failed
 * write is retried with progressively less: first without the photo previews
 * of this conversation, then without any previews, then with fewer entries.
 * The answer text is always the last thing to go. Returns false only when even
 * the current conversation alone could not be written.
 */
export function saveHistoryEntry<T extends HistoryEntryLike>(
  storage: StorageLike,
  entry: T,
  maxEntries = MAX_HISTORY_ENTRIES,
): boolean {
  let existing: T[] = [];
  try {
    const raw = storage.getItem(HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) existing = parsed as T[];
  } catch {
    existing = [];
  }

  const others = existing.filter((item) => item && item.id !== entry.id);
  const slim = withoutImages(entry);
  const plans: (() => T[])[] = [
    () => [entry, ...others].slice(0, maxEntries),
    () => [slim, ...others].slice(0, maxEntries),
    () => [slim, ...others.map(withoutImages)].slice(0, maxEntries),
    () => [slim, ...others.map(withoutImages)].slice(0, 10),
    () => [slim],
  ];

  for (const plan of plans) {
    try {
      storage.setItem(HISTORY_KEY, JSON.stringify(plan()));
      return true;
    } catch {
      // Quota exceeded or storage unavailable: try the next, smaller plan.
    }
  }
  return false;
}
