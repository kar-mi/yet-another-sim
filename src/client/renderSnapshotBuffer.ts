import type { Boss, Player, World } from "@shared/types";
import { length, shortestAngleDelta, sub, type Vec2 } from "@shared/math";
import { recordBufferReset, recordInterpolation } from "./perfMetrics";
import { computeWorldRenderKeys, getWorldRenderKeys, setWorldRenderKeys, type WorldRenderKeys } from "./worldRenderKeys";

const TICK_MS = 1000 / 60;
const MIN_RENDER_DELAY_MS = 90;
const MAX_RENDER_DELAY_MS = 220;
const DRAIN_TAU_S = 2;
const SNAPSHOT_BUFFER_MAX = 32;
const SNAPSHOT_GAP_RESET_MS = 1000;
const EXTRAPOLATE_MAX_MS = 150;
const CLOCK_SMOOTH = 0.02;
const GAP_DECAY = 0.999;
const BOSS_SNAP_THRESHOLD = 3;

type Snapshot = { t: number; world: World };
type EntityIndex = { players: Map<string, Player>; bosses: Map<string, Boss> };
type InterpolationBuffer = {
  world: World | null;
  players: Player[];
  playerPositions: Vec2[];
  bosses: Boss[];
  bossPositions: Vec2[];
};

export class RenderSnapshotBuffer {
  private readonly snapshots: Snapshot[] = [];
  private readonly entityIndexes = new WeakMap<World, EntityIndex>();
  private readonly interpolationBuffers: InterpolationBuffer[] = [this.makeInterpolationBuffer(), this.makeInterpolationBuffer()];
  private interpolationBufferIndex = 0;
  private worldRenderKeys: WorldRenderKeys | null = null;
  private renderDelayMs = MIN_RENDER_DELAY_MS;
  private lastAdaptNow = 0;
  private snapClockBase: number | null = null;
  private lastSnapshotWall = 0;
  private recentMaxGapMs = 0;

  reset(): void {
    this.snapshots.length = 0;
    this.snapClockBase = null;
  }

  start(world: World, tick: number): void {
    this.worldRenderKeys = computeWorldRenderKeys(world);
    this.reset();
    this.push(world, tick);
  }

  push(world: World, tick: number): void {
    const wall = performance.now();
    const gap = this.lastSnapshotWall ? wall - this.lastSnapshotWall : TICK_MS;
    if (this.lastSnapshotWall && gap > SNAPSHOT_GAP_RESET_MS) {
      this.reset();
      recordBufferReset();
    } else if (this.lastSnapshotWall) {
      this.recentMaxGapMs = Math.max(gap, this.recentMaxGapMs * GAP_DECAY);
    }
    this.lastSnapshotWall = wall;

    const desiredBase = wall - tick * TICK_MS;
    if (this.snapClockBase === null) this.snapClockBase = desiredBase;
    else {
      const alpha = Math.min(1, CLOCK_SMOOTH * (gap / TICK_MS));
      this.snapClockBase += (desiredBase - this.snapClockBase) * alpha;
    }
    const t = this.snapClockBase + tick * TICK_MS;
    if (!this.worldRenderKeys) this.worldRenderKeys = computeWorldRenderKeys(world);
    setWorldRenderKeys(world, this.worldRenderKeys);
    this.snapshots.push({ t, world });
    if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
  }

  getView(now: number): World | null {
    const buf = this.snapshots;
    if (buf.length === 0) return null;
    if (buf.length === 1) {
      recordInterpolation({ snapshotBuffer: 1, renderDelayMs: this.renderDelayMs, headroomMs: 0, extrapolated: false });
      return buf[0].world;
    }
    return this.interpolatedView(now);
  }

  private effectiveFloorMs(): number {
    return Math.min(MAX_RENDER_DELAY_MS, Math.max(MIN_RENDER_DELAY_MS, this.recentMaxGapMs + TICK_MS));
  }

  private interpolatedView(now: number): World {
    const buf = this.snapshots;
    const last = buf[buf.length - 1];
    const headroom = last.t - (now - this.renderDelayMs);
    if (headroom < TICK_MS) this.renderDelayMs = Math.min(MAX_RENDER_DELAY_MS, this.renderDelayMs + (TICK_MS - headroom));
    else {
      const dt = this.lastAdaptNow ? (now - this.lastAdaptNow) / 1000 : 0;
      if (headroom > 2 * TICK_MS) {
        const excess = headroom - 2 * TICK_MS;
        this.renderDelayMs = Math.max(this.effectiveFloorMs(), this.renderDelayMs - excess * Math.min(1, dt / DRAIN_TAU_S));
      }
    }
    this.lastAdaptNow = now;

    const target = now - this.renderDelayMs;
    if (target <= buf[0].t) {
      recordInterpolation({ snapshotBuffer: buf.length, renderDelayMs: this.renderDelayMs, headroomMs: headroom, extrapolated: false });
      return buf[0].world;
    }
    if (target >= last.t) {
      const prev = buf[buf.length - 2];
      if (target > last.t && last.t > prev.t) {
        const alpha = (last.t - prev.t + Math.min(target - last.t, EXTRAPOLATE_MAX_MS)) / (last.t - prev.t);
        recordInterpolation({ snapshotBuffer: buf.length, renderDelayMs: this.renderDelayMs, headroomMs: headroom, extrapolated: true });
        return this.interpolateWorld(prev.world, last.world, alpha);
      }
      recordInterpolation({ snapshotBuffer: buf.length, renderDelayMs: this.renderDelayMs, headroomMs: headroom, extrapolated: false });
      return last.world;
    }

    let prevIdx = 0;
    for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= target) { prevIdx = i; break; }
    const prev = buf[prevIdx];
    const next = buf[prevIdx + 1];
    const span = next.t - prev.t;
    const alpha = span > 0 ? Math.min(1, Math.max(0, (target - prev.t) / span)) : 1;
    recordInterpolation({ snapshotBuffer: buf.length, renderDelayMs: this.renderDelayMs, headroomMs: headroom, extrapolated: false });
    return this.interpolateWorld(prev.world, next.world, alpha);
  }

  private interpolateWorld(prev: World, next: World, t: number): World {
    const buf = this.interpolationBuffers[this.interpolationBufferIndex];
    this.interpolationBufferIndex = (this.interpolationBufferIndex + 1) % this.interpolationBuffers.length;
    const prevIndex = this.getEntityIndex(prev);
    this.ensurePlayerBuffer(buf, next.players);
    this.ensureBossBuffer(buf, next.bosses);
    for (let i = 0; i < next.players.length; i++) this.interpolatePlayerInto(buf.players[i], prevIndex.players.get(next.players[i].id), next.players[i], t);
    for (let i = 0; i < next.bosses.length; i++) this.interpolateBossInto(buf.bosses[i], prevIndex.bosses.get(next.bosses[i].id) ?? next.bosses[i], next.bosses[i], t);
    const world = Object.assign(buf.world ?? ({} as World), next);
    buf.world = world;
    world.time = lerp(prev.time, next.time, t);
    world.players = buf.players;
    world.bosses = buf.bosses;
    world.boss = buf.bosses[0]!;
    const renderKeys = getWorldRenderKeys(next) ?? getWorldRenderKeys(prev);
    if (renderKeys) setWorldRenderKeys(world, renderKeys);
    return world;
  }

  private getEntityIndex(world: World): EntityIndex {
    let index = this.entityIndexes.get(world);
    if (!index) {
      index = { players: new Map(world.players.map(player => [player.id, player])), bosses: new Map(world.bosses.map(boss => [boss.id, boss])) };
      this.entityIndexes.set(world, index);
    }
    return index;
  }

  private interpolatePlayerInto(out: Player, prev: Player | undefined, next: Player, t: number): void {
    const pos = out.pos;
    Object.assign(out, next);
    out.pos = pos;
    if (!prev) { out.pos.x = next.pos.x; out.pos.z = next.pos.z; return; }
    out.pos.x = lerp(prev.pos.x, next.pos.x, t);
    out.pos.z = lerp(prev.pos.z, next.pos.z, t);
    out.y = lerp(prev.y, next.y, t);
    out.facing = lerpAngle(prev.facing, next.facing, t);
  }

  private interpolateBossInto(out: Boss, prev: Boss, next: Boss, t: number): void {
    const snap = length(sub(next.pos, prev.pos)) > BOSS_SNAP_THRESHOLD;
    const pos = out.pos;
    Object.assign(out, next);
    out.pos = pos;
    out.pos.x = snap ? next.pos.x : lerp(prev.pos.x, next.pos.x, t);
    out.pos.z = snap ? next.pos.z : lerp(prev.pos.z, next.pos.z, t);
    out.facing = lerpAngle(prev.facing, next.facing, t);
  }

  private ensurePlayerBuffer(buf: InterpolationBuffer, players: Player[]): void {
    const rebuild = buf.players.length !== players.length || players.some((player, i) => buf.players[i].id !== player.id);
    if (!rebuild) return;
    buf.playerPositions = players.map(() => ({ x: 0, z: 0 }));
    buf.players = players.map((_, i) => ({ pos: buf.playerPositions[i] }) as Player);
  }

  private ensureBossBuffer(buf: InterpolationBuffer, bosses: Boss[]): void {
    const rebuild = buf.bosses.length !== bosses.length || bosses.some((boss, i) => buf.bosses[i].id !== boss.id);
    if (!rebuild) return;
    buf.bossPositions = bosses.map(() => ({ x: 0, z: 0 }));
    buf.bosses = bosses.map((_, i) => ({ pos: buf.bossPositions[i] }) as Boss);
  }

  private makeInterpolationBuffer(): InterpolationBuffer {
    return { world: null, players: [], playerPositions: [], bosses: [], bossPositions: [] };
  }
}

function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
function lerpAngle(a: number, b: number, t: number): number { return a + shortestAngleDelta(a, b) * t; }
