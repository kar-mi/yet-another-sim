import { afterEach, expect, test } from "bun:test";
import { PARTICIPANT_ID_REGEX } from "@model/protocol";

const MODULE = "../participant";
const originalSessionStorage = globalThis.sessionStorage;

function stubSessionStorage(store: Map<string, string> | null): void {
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: store
      ? {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
        clear: () => store.clear(),
        key: (index: number) => [...store.keys()][index] ?? null,
        get length() { return store.size; },
      } satisfies Storage
      : {
        getItem: () => { throw new Error("sessionStorage unavailable"); },
        setItem: () => { throw new Error("sessionStorage unavailable"); },
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      } as unknown as Storage,
  });
}

afterEach(() => {
  if (originalSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: originalSessionStorage });
  } else {
    delete (globalThis as { sessionStorage?: Storage }).sessionStorage;
  }
});

test("the participant id is generated once, persisted, and reused", async () => {
  const store = new Map<string, string>();
  stubSessionStorage(store);
  const { participantId } = await import(`${MODULE}?persisted`);

  const first = participantId();
  expect(first).toMatch(PARTICIPANT_ID_REGEX);
  expect(participantId()).toBe(first);
  expect([...store.values()]).toEqual([first]);
});

test("the participant id survives sessionStorage being unavailable", async () => {
  stubSessionStorage(null);
  const { participantId } = await import(`${MODULE}?unavailable`);

  const first = participantId();
  expect(first).toMatch(PARTICIPANT_ID_REGEX);
  expect(participantId()).toBe(first);
});
