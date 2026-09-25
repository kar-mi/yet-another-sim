import type { SystemEvent } from "@model/protocol";
import type { Hint } from "@model/types";

export function dueHints(hints: readonly Hint[], prevTime: number, time: number): Hint[] {
  return hints.filter(hint => hint.t > prevTime && hint.t <= time);
}

export function systemText(event: SystemEvent, selfParticipantId: string | null): string {
  switch (event.kind) {
    case "joined":
      return `A player joined (${event.connected} connected)`;
    case "left":
      return `A player left (${event.connected} connected)`;
    case "hostChanged":
      return event.hostParticipantId === selfParticipantId ? "You are now the host" : "The host changed";
    case "slotClaimed":
      return `${event.playerId.toUpperCase()} was claimed`;
    case "slotReleased":
      return `${event.playerId.toUpperCase()} was released`;
    case "raidSelected":
      return `Raid selected: ${event.raidName}`;
  }
}

export function formatClock(at: number): string {
  const date = new Date(at);
  return [date.getHours(), date.getMinutes(), date.getSeconds()].map(part => String(part).padStart(2, "0")).join(":");
}
