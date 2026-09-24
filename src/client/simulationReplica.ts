import { TICK_DT } from "@shared/constants";
import type { Frame } from "@model/protocol";
import type { World } from "@model/types";
import { computeBotIntents } from "../engine/bots/botIntent";
import { tick } from "../engine/sim";


export type AppliedReplicaFrames = {
  kind: "applied";
  applied: number;
  snapshots: { tick: number; world: World }[];
};

export class SimulationReplica {
  world: World | null = null;
  appliedTick = 0;

  adopt(world: World, baseTick: number, frames: Frame[]): World {
    this.world = world;
    this.appliedTick = baseTick;
    for (const frame of frames) this.stepOne(frame);
    return this.world;
  }

  apply(startTick: number, frames: Frame[]): AppliedReplicaFrames | { kind: "gap" } {
    if (!this.world) return { kind: "applied", applied: 0, snapshots: [] };
    const offset = this.appliedTick - startTick;
    if (offset < 0) return { kind: "gap" };

    const snapshots: { tick: number; world: World }[] = [];
    for (let i = offset; i < frames.length; i++) {
      this.stepOne(frames[i]);
      snapshots.push({ tick: this.appliedTick, world: this.world! });
    }
    return { kind: "applied", applied: snapshots.length, snapshots };
  }

  private stepOne(frame: Frame): void {
    const world = this.world;
    if (!world) return;
    if (world.status === "running") {
      const prepared = applyFrameControls(world, frame);
      const bots = computeBotIntents(prepared, TICK_DT);
      this.world = tick(prepared, { ...bots, ...frame.intents }, TICK_DT);
      if (this.world.log.length > 0) this.world.log.length = 0;
    }
    this.appliedTick++;
  }
}

export function applyFrameControls(world: World, frame: Frame): World {
  return {
    ...world,
    botsInvisible: frame.botsInvisible ?? false,
    players: world.players.map(player => {
      const human = frame.intents[player.id] !== undefined;
      const control = human ? "human" : "bot";
      const invincible = human ? player.invincible : frame.botsInvincible;
      return player.control === control && player.invincible === invincible
        ? player
        : { ...player, control, invincible, cooldownsDisabled: player.control === control ? player.cooldownsDisabled : false };
    }),
  };
}
