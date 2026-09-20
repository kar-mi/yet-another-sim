import { PARTICIPANT_ID_REGEX } from "@shared/protocol";

const PARTICIPANT_KEY = "yas_participant_id";

let cached: string | null = null;

function read(): string | null {
  try {
    const raw = sessionStorage.getItem(PARTICIPANT_KEY);
    return raw !== null && PARTICIPANT_ID_REGEX.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

function write(id: string): void {
  try {
    sessionStorage.setItem(PARTICIPANT_KEY, id);
  } catch {
    // sessionStorage unavailable (e.g. private browsing) - the cached id lasts this page load.
  }
}

export function participantId(): string {
  if (cached) return cached;
  cached = read() ?? crypto.randomUUID();
  write(cached);
  return cached;
}
