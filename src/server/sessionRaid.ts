import { dirname, join } from "path";
import { readRaidObject } from "./raidFileReader";
import { applyBotPatterns, loadBotPatterns, loadRaid } from "../engine/raidLoader";
import { BOSS_REGISTRY, DEFAULT_BOSS_ID } from "../engine/bossRegistry";
import type { RaidDef } from "../engine/raidSchema";
import { CLOCK_SPOTS, EMPTY_RAID_ID, ROSTER, type Frame } from "@shared/protocol";
import type { Intent, World } from "@shared/types";

export interface SessionLog {
  header(raidId: string, world: World): void;
  frame(startTick: number, frames: Frame[]): void;
  close(): void;
}

type RaidPlayerDef = RaidDef["players"][number];

export function mergePendingIntent(previous: Intent | undefined, next: Intent): Intent {
  return {
    move: { x: next.move.x, z: next.move.z },
    facing: next.facing ?? previous?.facing,
    jump: previous?.jump || next.jump || undefined,
    sprint: previous?.sprint || next.sprint || undefined,
    antiKnockback: previous?.antiKnockback || next.antiKnockback || undefined,
    provoke: previous?.provoke || next.provoke || undefined,
    cycleTarget: previous?.cycleTarget || next.cycleTarget || undefined,
    toggleInvincibility: previous?.toggleInvincibility || next.toggleInvincibility || undefined,
  };
}

export function createEmptyRaid(): RaidDef {
  const players: RaidPlayerDef[] = ROSTER.map(({ id, role }) => ({ id, role, spawn: CLOCK_SPOTS[id] }));
  const preset = BOSS_REGISTRY[DEFAULT_BOSS_ID];
  const boss = { pos: [0, 0] as [number, number], ...preset };
  return {
    name: "(empty)",
    arena: { zones: [{ kind: "circle", center: [0, 0] as [number, number], radius: 20 }], floorPlan: "squares" },
    duration: 30,
    boss,
    bosses: [{ id: "boss", targetable: true, hidden: false, sink: 0, ...boss }],
    players,
    events: [],
  };
}

export async function loadSessionRaid(raidId: string, raidsDir: string): Promise<RaidDef> {
  if (raidId === EMPTY_RAID_ID) return createEmptyRaid();

  const raid = loadRaid(await readRaidObject(join(raidsDir, raidId)));
  if (!raid.botPatterns) return raid;
  const categoryDir = dirname(raidId);
  return applyBotPatterns(raid, loadBotPatterns(await readRaidObject(join(raidsDir, categoryDir, raid.botPatterns))));
}
