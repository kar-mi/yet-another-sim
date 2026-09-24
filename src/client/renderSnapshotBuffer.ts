import { TICK_MS } from "@shared/constants";
import type { Boss, Player, World } from "@model/types";
import { length, shortestAngleDelta, sub, type Vec2 } from "@shared/math";
import { recordBufferReset, recordInterpolation } from "./perfMetrics";
import { computeWorldRenderKeys, getWorldRenderKeys, setWorldRenderKeys, type WorldRenderKeys } from "./worldRenderKeys";

const MIN_RENDER_DELAY_MS = 90;
const MAX_RENDER_DELAY_MS = 220;
const SNAPSHOT_BUFFER_MAX = 32;
const SNAPSHOT_GAP_RESET_MS = 1000;
const EXTRAPOLATE_MAX_MS = 150;
const GAP_DECAY = 0.999;
const BOSS_SNAP_THRESHOLD = 3;
const RATE_GAIN = 0.02;
const MAX_RATE_DEVIATION = 0.08;
const RATE_DEADBAND_TICKS = 1;
const RESNAP_TICKS = 30;

type Snapshot = { tick: number; world: World };
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
  private renderTick: number | null = null;
  private lastViewNow = 0;
  private playbackRate = 1;
  private lastSnapshotWall = 0;
  private recentMaxGapMs = 0;

  reset(): void {
    this.snapshots.length = 0;
    this.renderTick = null;
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

    if (!this.worldRenderKeys) this.worldRenderKeys = computeWorldRenderKeys(world);
    setWorldRenderKeys(world, this.worldRenderKeys);
    this.snapshots.push({ tick, world });
    if (this.snapshots.length > SNAPSHOT_BUFFER_MAX) this.snapshots.shift();
  }

  getView(now: number): World | null {
    const buf = this.snapshots;
    if (buf.length === 0) return null;
    const latest = buf[buf.length - 1].tick;
    const delayTicks = this.targetDelayTicks();
    const renderTick = this.advanceRenderTick(now, latest - delayTicks, latest);
    const view = this.viewAt(renderTick);
    recordInterpolation({
      snapshotBuffer: buf.length,
      renderDelayMs: delayTicks * TICK_MS,
      headroomMs: (latest - renderTick) * TICK_MS,
      playbackRate: this.playbackRate,
      extrapolated: renderTick > latest && buf.length > 1,
    });
    return view;
  }

  private targetDelayTicks(): number {
    return Math.min(MAX_RENDER_DELAY_MS, Math.max(MIN_RENDER_DELAY_MS, this.recentMaxGapMs + TICK_MS)) / TICK_MS;
  }

  private advanceRenderTick(now: number, target: number, latest: number): number {
    if (this.renderTick === null) {
      this.renderTick = target;
      this.playbackRate = 1;
    } else {
      const error = target - this.renderTick;
      if (Math.abs(error) > RESNAP_TICKS) {
        this.renderTick = target;
        this.playbackRate = 1;
      } else {
        const outside = Math.sign(error) * Math.max(0, Math.abs(error) - RATE_DEADBAND_TICKS);
        this.playbackRate = 1 + Math.min(MAX_RATE_DEVIATION, Math.max(-MAX_RATE_DEVIATION, outside * RATE_GAIN));
        this.renderTick += Math.max(0, now - this.lastViewNow) / TICK_MS * this.playbackRate;
      }
    }
    this.lastViewNow = now;
    this.renderTick = Math.min(this.renderTick, latest + EXTRAPOLATE_MAX_MS / TICK_MS);
    return this.renderTick;
  }

  private viewAt(renderTick: number): World {
    const buf = this.snapshots;
    const first = buf[0];
    const last = buf[buf.length - 1];
    if (buf.length === 1 || renderTick <= first.tick) return first.world;
    if (renderTick >= last.tick) {
      const prev = buf[buf.length - 2];
      if (renderTick === last.tick) return last.world;
      return this.interpolateWorld(prev.world, last.world, (renderTick - prev.tick) / (last.tick - prev.tick));
    }

    let prevIdx = 0;
    for (let i = buf.length - 1; i >= 0; i--) if (buf[i].tick <= renderTick) { prevIdx = i; break; }
    const prev = buf[prevIdx];
    const next = buf[prevIdx + 1];
    return this.interpolateWorld(prev.world, next.world, (renderTick - prev.tick) / (next.tick - prev.tick));
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
