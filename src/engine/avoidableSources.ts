import type { RaidDef } from "./schema/raidSchema";

type RaidEvent = RaidDef["events"][number];

export function collectAvoidableSources(events: RaidEvent[]): Record<string, true> {
  const sources: Record<string, true> = {};
  const mark = (eventId: string, slot?: string): void => {
    sources[slot === undefined ? eventId : `${eventId}:${slot}`] = true;
  };

  for (const event of events) {
    switch (event.type) {
      case "tether_source":
        if (event.beam?.avoidable) mark(event.id, "beam");
        break;
      case "spread_stack":
        if (event.spread.avoidable) mark(event.id, "spread");
        if (event.stack.avoidable) mark(event.id, "stack");
        break;
      case "effect_resolver":
        if (event.action.avoidable) mark(event.id);
        break;
      case "aoe":
      case "targeted":
      case "tower":
      case "chain":
      case "group":
      case "inverse":
      case "gaze":
      case "divebomb":
      case "effect_burst":
      case "effect_check":
        if (event.avoidable) mark(event.id);
        break;
      default:
        break;
    }
  }
  return sources;
}
