import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DEFAULT_HUD_LAYOUT, loadSettings } from "../settings";

const originalLocalStorage = globalThis.localStorage;
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
      key: (index: number) => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    } satisfies Storage,
  });
});

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});

describe("HUD layout settings", () => {
  test("uses the complete default layout when no settings are saved", () => {
    const settings = loadSettings();
    expect(settings.hudLayout).toEqual(DEFAULT_HUD_LAYOUT);
    expect(settings.minimapZoom).toBe(2);
  });

  test("preserves saved groups and fills missing groups from the defaults", () => {
    const party = { x: 0.25, y: 0.3, scale: 1.1, opacity: 0.5, hidden: true };
    values.set("yas_settings", JSON.stringify({ uiScale: 0.8, hudLayout: { party } }));

    const settings = loadSettings();

    expect(settings.uiScale).toBe(0.8);
    expect(settings.hudLayout.party).toEqual(party);
    expect(settings.hudLayout.hotbar).toEqual(DEFAULT_HUD_LAYOUT.hotbar);
    expect(Object.keys(settings.hudLayout)).toHaveLength(12);
  });

  test("includes the replay-only panels in fresh and partially saved layouts", () => {
    values.set("yas_settings", JSON.stringify({ hudLayout: { party: DEFAULT_HUD_LAYOUT.party } }));

    const layout = loadSettings().hudLayout;

    expect(layout.replayevents).toEqual(DEFAULT_HUD_LAYOUT.replayevents);
    expect(layout.replayseek).toEqual(DEFAULT_HUD_LAYOUT.replayseek);
    expect(layout.replayevents?.hidden).toBe(false);
    expect(layout.replayseek?.hidden).toBe(false);
  });

  test("falls back to the complete default layout when saved settings are invalid", () => {
    values.set("yas_settings", "not json");

    expect(loadSettings().hudLayout).toEqual(DEFAULT_HUD_LAYOUT);
  });

  test("restores a valid minimap zoom and clamps an invalid saved value", () => {
    values.set("yas_settings", JSON.stringify({ minimapZoom: 2.5 }));
    expect(loadSettings().minimapZoom).toBe(2.5);

    values.set("yas_settings", JSON.stringify({ minimapZoom: 9 }));
    expect(loadSettings().minimapZoom).toBe(4);
  });
});
