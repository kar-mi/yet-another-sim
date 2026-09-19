import type { Scene } from "@babylonjs/core/scene";
import type { ActiveMechanic } from "@shared/types";
import type { FloorAoe } from "@effects";
import { syncFloorTelegraphs, disposeFloorTelegraphs, spawnElementBurst, type FloorTelegraphMap } from "@effects/babylon";

// Only burst for hits that landed within this long of now, so replay seeks don't replay old bursts.
const BURST_WINDOW = 0.3;

// Outlined AoEs stay quiet unless vfx.burst turns them on; vfx.burst.element overrides the floor's.
function burstElement(aoe: FloorAoe): FloorAoe["element"] {
  const burst = aoe.vfx?.burst;
  if (burst?.enabled === false) return undefined;
  if (aoe.style === "outline" && !burst?.enabled) return undefined;
  return burst?.element ?? aoe.element;
}

export class TelegraphLayer {
  private meshes: FloorTelegraphMap = new Map();
  // Element AoEs waiting for their hit, and ones already burst (kept while present so each bursts once).
  private pendingBursts = new Map<string, FloorAoe>();
  private burstIds = new Set<string>();
  private lastTime = 0;

  constructor(private scene: Scene) {}

  sync(mechanics: ActiveMechanic[], time: number): void {
    // A replay seek or restart rewinds the clock; forget which AoEs have burst so they fire again.
    if (time < this.lastTime) {
      this.pendingBursts.clear();
      this.burstIds.clear();
    }
    this.lastTime = time;
    const aoes = mechanics.filter(m => m.floorAoe).map(m => m.floorAoe!);
    const resolvedIds = new Set(mechanics.filter(m => m.resolved).map(m => m.id));
    syncFloorTelegraphs(this.scene, this.meshes, aoes, time, resolvedIds);
    this.syncBursts(aoes, time);
  }

  private syncBursts(aoes: FloorAoe[], time: number): void {
    const present = new Set<string>();
    for (const aoe of aoes) {
      if (!burstElement(aoe)) continue;
      present.add(aoe.id);
      if (this.burstIds.has(aoe.id)) continue;
      if (time < aoe.resolveAt) {
        this.pendingBursts.set(aoe.id, aoe);
        continue;
      }
      this.pendingBursts.delete(aoe.id);
      this.burstIds.add(aoe.id);
      this.burst(aoe, time);
    }
    // The mechanic can leave `active` before a frame lands on or after its resolveAt.
    for (const [id, aoe] of this.pendingBursts) {
      if (present.has(id)) continue;
      this.pendingBursts.delete(id);
      this.burst(aoe, time);
    }
    for (const id of this.burstIds) if (!present.has(id)) this.burstIds.delete(id);
  }

  private burst(aoe: FloorAoe, time: number): void {
    if (time < aoe.resolveAt || time - aoe.resolveAt > BURST_WINDOW) return;
    spawnElementBurst(this.scene, burstElement(aoe)!, aoe.shape, aoe.color, aoe.vfx?.burst);
  }

  dispose(): void {
    disposeFloorTelegraphs(this.meshes);
    this.pendingBursts.clear();
    this.burstIds.clear();
    this.lastTime = 0;
  }
}
