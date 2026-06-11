import type { ForsakenPlan, Player, World } from "../shared/types";
import type { Vec2 } from "../shared/math";
import { add, normalize, scale, sub } from "../shared/math";
import { activeForsakenCharge } from "./systems/forsakenAssign";

// Rule-driven Forsaken bot positioning (docs/forsaken-raid-implementation-plan.md).
// All tower-wave spots are expressed in a rotating frame: "new north" is the bisector
// of the wave's two towers, and left/right follow the authored tower-N-left/right ids
// (the boss's left/right when it faces new north). NOTE: the user's strat callouts are
// rotated 180° from this frame — their "left" tower is the authored tower-N-right and
// their "south" points radially outward, away from the boss.

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

// Stack side tie-breaks (left = the authored tower-N-left = the DPS-stack tower):
// a DPS-held stack goes left, a support-held stack right; between two supports the
// healer goes right; same-role fallback = ranged left, then lower id left.
function stackSides(stacks: Player[]): [Player | undefined, Player | undefined] {
  const [a, b] = stacks;
  if (!a || !b) return [a, b];
  if ((a.role === "dps") !== (b.role === "dps")) return a.role === "dps" ? [a, b] : [b, a];
  if ((a.role === "healer") !== (b.role === "healer")) return a.role === "healer" ? [b, a] : [a, b];
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

// Odd towers, in the user's frame: "left" = the authored tower-N-right, "south" =
// radially outward, away from the boss. The support stack resolves at the middle of
// the right tower (on the boss ring), with the cone deeper in the same tower baited
// radially outward by the Y healer (wave 1: at the D waymark); the Y tank holds the
// tower's outer flank — all four form one 4-person stack. The DPS stack resolves on
// the left tower's inner (boss-side) edge with the defam behind it in the same tower
// (>2.5 from everyone but inside the 4y stack); the Y DPS join that stack from just
// outside the tower, inside the boss ring — 4 soakers again.
function oddTowerSpots(world: World, plan: ForsakenPlan, towerNumber: number, left: Vec2, right: Vec2, north: Vec2): SpotMap {
  const latLeft = rotateCCW(north);
  const latRight = scale(latLeft, -1);
  const uLeft = normalize(left);
  const uRight = normalize(right);
  const spots: SpotMap = {};
  const x = groupMembers(world, plan, towerNumber, "X");
  const y = groupMembers(world, plan, towerNumber, "Y");
  const charge = (p: Player) => activeForsakenCharge(p, world.time);

  const [leftStack, rightStack] = stackSides(x.filter(p => charge(p) === "stack"));
  const cone = x.find(p => charge(p) === "cone");
  const defam = x.find(p => charge(p) === "defamation");

  const supportStackSpot = right;                       // middle of the right tower, on the boss ring
  const coneSpot = add(right, scale(uRight, 2.5));      // outward side of the right tower, aimed at the Y healer
  const coneBaitSpot = add(right, scale(uRight, 3.5));  // just outside the tower, radially out
  const dpsStackSpot = add(left, scale(uLeft, -2.4));   // inner (boss-side) edge of the left tower
  const defamSpot = add(left, scale(uLeft, 1.2));       // behind the stack in the left tower

  fillSlots(spots, [
    { spot: dpsStackSpot, preferred: leftStack },
    { spot: supportStackSpot, preferred: rightStack },
    { spot: coneSpot, preferred: cone },
    { spot: defamSpot, preferred: defam },
  ], x);

  const lateral = scale(rotateCCW(uLeft), -1);
  for (const p of y) {
    if (p.role === "tank") spots[p.id] = add(right, scale(latRight, 3.5));
    else if (p.role === "healer") spots[p.id] = coneBaitSpot;
    else spots[p.id] = add(add(left, scale(uLeft, -4.0)), scale(lateral, isRangedDps(p) ? 0.6 : -0.6));
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

  const baiters = {
    left: add(scale(latLeft, 5.5), scale(north, 1.5)),
    right: add(scale(latRight, 5.5), scale(north, 1.5)),
  };
  // Even-wave towers sit on the intercardinals (radius ~10.25). With towers at radius
  // 3, the cone hugs the inner edge on the ray toward its Y baiter (so the baiter stays
  // its nearest player), the defam the far/new-north side.
  const coneSpots = {
    left: add(left, scale(normalize(sub(baiters.left, left)), 2.6)),
    right: add(right, scale(normalize(sub(baiters.right, right)), 2.6)),
  };
  const defamSpots = { left: add(left, scale(north, 2.2)), right: add(right, scale(north, 2.2)) };

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
    if (p.role === "healer") spots[p.id] = baiters.left;
    else if (p.role === "tank") spots[p.id] = add(scale(north, -3.4), scale(latLeft, 1.2));
    else if (isRangedDps(p)) spots[p.id] = baiters.right;
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
