import { SNAPSHOT_FORMAT_VERSION } from "@shared/replay";
import type { Frame, ServerMessage } from "@shared/protocol";
import type { World } from "@shared/types";

type Snapshot = { formatVersion: number; tick: number; world: unknown };

export class PullSnapshot {
  private latest: Snapshot | null = null;

  reset(): void {
    this.latest = null;
  }

  accept(formatVersion: number, tick: number, world: unknown, inputLength: number, running: boolean): string | null {
    if (formatVersion !== SNAPSHOT_FORMAT_VERSION) {
      return `Unsupported snapshot format ${formatVersion}; expected ${SNAPSHOT_FORMAT_VERSION}`;
    }
    if (!running || tick > inputLength || (this.latest && tick <= this.latest.tick)) return null;
    if (!world || typeof world !== "object" || !("arena" in world) || !("players" in world)) return null;
    this.latest = { formatVersion, tick, world };
    return null;
  }

  startedMessage(world: World, inputLog: Frame[], playerId: string | null): ServerMessage {
    if (this.latest) {
      return {
        type: "started",
        world: this.latest.world as World,
        baseTick: this.latest.tick,
        yourPlayerId: playerId,
        tick: inputLog.length,
        frames: inputLog.slice(this.latest.tick),
      };
    }
    return { type: "started", world, baseTick: 0, yourPlayerId: playerId, tick: inputLog.length, frames: inputLog };
  }
}
