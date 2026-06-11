import type { ForsakenPlan, Player, World } from "../shared/types";
import type { Vec2 } from "../shared/math";
import { add, normalize, scale } from "../shared/math";
import { activeForsakenCharge } from "./systems/forsakenAssign";

// Rule-driven Forsaken bot positioning (docs/forsaken-raid-implementation-plan.md).
// All tower-wave spots are expressed in a rotating frame: "new north" is the bisector
// of the wave's two towers, and left/right follow the authored tower-N-left/right ids
// (the boss's left/right when it faces new north).

const CLOSE_BAIT_RADIUS = 4.1; // max melee: past holders bait close
const FAR_BAIT_RADIUS = 7.5;   // future holders bait far

function rotateCCW(v: Vec2): Vec2 {
  return { x: -v.z, z: v.x };
}

// Tanks count as melee for side tie-breaks; ranged vs melee DPS follows the r*/m* ids.
function isRangedDps(player: Player): boolean {
  return player.role === "dps" && player.id.startsWith("r");
}

function towerPosition(world: World, id: string): Vec2 | undefined {
  return world.towers.find(t => t.id === id)?.pos ?? world.pendingTowers.find(t => t.id === id)?.pos;
}

function groupMembers(world: World, plan: ForsakenPlan, towerNumber: number, group: "X" | "Y"): Player[] {
  return world.players.filter(p => p.alive && plan.players[p.id]?.towerGroupBySlot[towerNumber - 1] === group);
}

// Stack side tie-breaks: healer left; otherwise tank counts as melee (ranged left,
// melee right); same-job fallback = lower id left.
function stackSides(stacks: Player[]): [Player | undefined, Player | undefined] {
  const [a, b] = stacks;
  if (!a || !b) return [a, b];
  if ((a.role === "healer") !== (b.role === "healer")) return a.role === "healer" ? [a, b] : [b, a];
  if (isRangedDps(a) !== isRangedDps(b)) return isRangedDps(a) ? [a, b] : [b, a];
  return a.id <= b.id ? [a, b] : [b, a];
}

type SpotMap = Record<string, Vec2>;

// Give each slot to its preferred carrier, then hand leftover slots to the remaining
// pool players in order so a missed swap or death never strands a tower unsoaked.
function fillSlots(spots: SpotMap, slots: { spot: Vec2; preferred?: Player }[], pool: Player[]): void {
  const used = new Set<string>();
  const open: Vec2[] = [];
  for (const slot of slots) {
    if (slot.preferred && !used.has(slot.preferred.id)) {
      spots[slot.preferred.id] = slot.spot;
      used.add(slot.preferred.id);
    } else {
      open.push(slot.spot);
    }
  }
  for (const player of pool) {
    if (used.has(player.id)) continue;
    const spot = open.shift();
    if (!spot) break;
    spots[player.id] = spot;
    used.add(player.id);
  }
}

// Odd towers: X holds 2 stacks + 1 cone + 1 defam. Left tower = cone + left stack,
// right tower = defam + right stack. Y supports share the left stack from outside the
// tower (tank north, healer south); Y DPS stand in the right stack.
function oddTowerSpots(world: World, plan: ForsakenPlan, towerNumber: number, left: Vec2, right: Vec2, north: Vec2): SpotMap {
  const latLeft = rotateCCW(north);
  const latRight = scale(latLeft, -1);
  const uLeft = normalize(left);
  const spots: SpotMap = {};
  const x = groupMembers(world, plan, towerNumber, "X");
  const y = groupMembers(world, plan, towerNumber, "Y");
  const charge = (p: Player) => activeForsakenCharge(p, world.time);

  const [leftStack, rightStack] = stackSides(x.filter(p => charge(p) === "stack"));
  const cone = x.find(p => charge(p) === "cone");
  const defam = x.find(p => charge(p) === "defamation");

  const leftStackSpot = scale(uLeft, 4.0);              // boss hitbox ring, just inside the left tower
  const rightStackSpot = add(right, scale(north, 2.0)); // front of the right tower, toward new north
  const coneSpot = scale(uLeft, 9.45);                  // outer edge of the left tower; nearest player is the left stack, so the cone aims inward
  const defamSpot = add(right, scale(latRight, 2.5));   // outer-right edge of the right tower, clear of the stack

  fillSlots(spots, [
    { spot: leftStackSpot, preferred: leftStack },
    { spot: rightStackSpot, preferred: rightStack },
    { spot: coneSpot, preferred: cone },
    { spot: defamSpot, preferred: defam },
  ], x);

  for (const p of y) {
    if (p.role === "tank") spots[p.id] = add(scale(uLeft, 1.8), scale(north, 1.3));
    else if (p.role === "healer") spots[p.id] = add(scale(uLeft, 1.8), scale(north, -1.3));
    else spots[p.id] = add(rightStackSpot, add(scale(north, 2.8), scale(isRangedDps(p) ? latLeft : latRight, 0.8)));
  }
  return spots;
}

// Even towers: X holds 2 cones + 2 defams and each tower is soaked by one cone (on the
// boss hitbox toward the tower's outer side) + one defam (north/far side of the tower).
// Mixed pairs put supports in the left tower and DPS in the right; role-split pairs use
// healer left / tank right and melee left / ranged right. Y healer/ranged bait the
// cones laterally; Y tank + melee hold the outer boss hitbox opposite the towers.
function evenTowerSpots(world: World, plan: ForsakenPlan, towerNumber: number, left: Vec2, right: Vec2, north: Vec2): SpotMap {
  const latLeft = rotateCCW(north);
  const latRight = scale(latLeft, -1);
  const spots: SpotMap = {};
  const x = groupMembers(world, plan, towerNumber, "X");
  const y = groupMembers(world, plan, towerNumber, "Y");
  const charge = (p: Player) => activeForsakenCharge(p, world.time);

  // Even-wave towers sit on the intercardinals (radius ~10.25), so they never overlap
  // the boss hitbox: the cone takes the tower's inner (boss-side) edge shifted toward
  // the tower's outer flank, the defam the far/new-north side.
  const coneSpots = {
    left: add(left, add(scale(normalize(left), -3.0), scale(latLeft, 0.8))),
    right: add(right, add(scale(normalize(right), -3.0), scale(latRight, 0.8))),
  };
  const defamSpots = { left: add(left, scale(north, 2.5)), right: add(right, scale(north, 2.5)) };

  const xPairs = plan.pairs.filter(pair => pair.members.some(id => x.some(p => p.id === id)));
  const mixed = xPairs.length > 0 && xPairs.every(pair => {
    const kinds = pair.members
      .map(id => x.find(p => p.id === id))
      .map(p => (p ? charge(p) : undefined));
    return kinds.includes("cone") && kinds.includes("defamation");
  });

  const sideOf = (p: Player): "left" | "right" => {
    if (mixed) return p.role === "dps" ? "right" : "left";
    if (p.role === "healer") return "left";
    if (p.role === "tank") return "right";
    return isRangedDps(p) ? "right" : "left";
  };

  for (const side of ["left", "right"] as const) {
    const sidePlayers = x.filter(p => sideOf(p) === side);
    const coneCarrier = sidePlayers.find(p => charge(p) === "cone");
    fillSlots(spots, [
      { spot: coneSpots[side], preferred: coneCarrier },
      { spot: defamSpots[side], preferred: sidePlayers.find(p => p !== coneCarrier) },
    ], sidePlayers);
  }

  for (const p of y) {
    if (p.role === "healer") spots[p.id] = add(scale(latLeft, 5.5), scale(north, 1.5));
    else if (p.role === "tank") spots[p.id] = add(scale(north, -3.4), scale(latLeft, 1.2));
    else if (isRangedDps(p)) spots[p.id] = add(scale(latRight, 5.5), scale(north, 1.5));
    else spots[p.id] = add(scale(north, -3.4), scale(latRight, 1.2));
  }
  return spots;
}

function towerSpot(player: Player, world: World, towerNumber: number): Vec2 | undefined {
  const plan = world.forsakenPlan;
  if (!plan || !plan.players[player.id]) return undefined;
  const left = towerPosition(world, `tower-${towerNumber}-left`);
  const right = towerPosition(world, `tower-${towerNumber}-right`);
  if (!left || !right) return undefined;
  const north = normalize(add(left, right));
  const spots = towerNumber % 2 === 1
    ? oddTowerSpots(world, plan, towerNumber, left, right, north)
    : evenTowerSpots(world, plan, towerNumber, left, right, north);
  return spots[player.id];
}

// Everyone baits the clones, clustered toward the new north of the simultaneous tower
// wave: past holders at max melee, future holders far on the same bearing. The locked
// closest target is therefore a past baiter, and the Past cleave (boss facing + π)
// fires away from the towers; a Future lock would aim at the cluster itself, which is
// equally clear of the towers.
function baitSpot(player: Player, world: World, baitIndex: number): Vec2 | undefined {
  const assignment = world.forsakenPlan?.players[player.id];
  if (!assignment) return undefined;
  // Cleave N detonates alongside tower wave 2N+1; wave 9 doesn't exist (bait 4 has no
  // towers), so fall back to the continued 45°-per-wave clockwise rotation.
  const wave = 2 * baitIndex + 1;
  const left = towerPosition(world, `tower-${wave}-left`);
  const right = towerPosition(world, `tower-${wave}-right`);
  const azimuth = left && right
    ? Math.atan2(left.x + right.x, left.z + right.z)
    : (wave * Math.PI) / 4;
  const slot = (assignment.pairIndex - 1.5) * ((12 * Math.PI) / 180);
  const radius = assignment.ending === "past" ? CLOSE_BAIT_RADIUS : FAR_BAIT_RADIUS;
  return { x: radius * Math.sin(azimuth + slot), z: radius * Math.cos(azimuth + slot) };
}

export function forsakenSolverWaypoint(player: Player, world: World): Vec2 | undefined {
  const solver = world.botSolvers?.forsaken;
  if (!solver) return undefined;

  for (const window of solver.baitWindows ?? []) {
    if (world.time < window.start || world.time > window.end) continue;
    const spot = baitSpot(player, world, window.index) ?? solver.baitSpots?.[player.id]?.[window.index - 1];
    if (spot) return spot;
  }

  for (const window of solver.towerWindows) {
    if (world.time < window.start || world.time > window.end) continue;
    const spot = towerSpot(player, world, window.tower) ?? solver.towerSpots[player.id]?.[window.tower - 1];
    if (spot) return spot;
  }

  return undefined;
}
