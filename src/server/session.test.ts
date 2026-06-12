import { expect, test } from "bun:test";
import { loadRaid } from "../engine/raidLoader";
import { ClientMessageSchema, EMPTY_RAID_ID, MAX_OBSERVERS } from "../shared/protocol";
import type { ServerMessage } from "../shared/protocol";
import { loadSessionRaid, Session, SessionManager, type SessionStatus } from "./session";

const D = 5.66;
type Vec = [number, number];
type Override = { spawn?: Vec; pattern?: { t: number; pos: Vec }[] };

// Canonical roster builder for test raids (matches the enforced mt/ot/h1/h2/r1/r2/m1/m2 order).
// Control is not authored; slots determine it, so claim a slot to make a player human.
function players(over: Record<string, Override> = {}) {
  const base: [string, string, Vec][] = [
    ["mt", "tank", [0, 8]], ["ot", "tank", [0, -8]],
    ["h1", "healer", [-8, 0]], ["h2", "healer", [8, 0]],
    ["r1", "dps", [-D, D]], ["r2", "dps", [D, D]],
    ["m1", "dps", [-D, -D]], ["m2", "dps", [D, -D]],
  ];
  return base.map(([id, role, spawn]) => ({ id, role, spawn, ...(over[id] ?? {}) }));
}

function testRaid() {
  return loadRaid({
    name: "Session Test",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
    duration: 30,
    players: players({
      mt: { spawn: [0, 0] },
      h1: { spawn: [0, 0], pattern: [{ t: 0, pos: [5, 0] }] },
    }),
    events: [],
  });
}

function alternateRaid() {
  return loadRaid({
    name: "Alternate Test",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
    duration: 30,
    players: players(),
    events: [],
  });
}

function makeSession(options: { now?: () => number; lobbyTimeoutMs?: number } = {}) {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new Session({
    id: "test-room",
    raidId: "test-raid",
    raid: testRaid(),
    send: (clientId, message) => sent.push({ clientId, message: typeof message === "string" ? JSON.parse(message) as ServerMessage : message }),
    autoTick: false,
    now: options.now,
    lobbyTimeoutMs: options.lobbyTimeoutMs,
  });
  return { session, sent };
}

test("client can claim only one slot", () => {
  const { session, sent } = makeSession();
  session.join("c1");

  session.claimSlot("c1", "mt");
  session.claimSlot("c1", "ot");

  expect(session.slots.get("mt")).toBe("c1");
  expect(session.slots.get("ot")).toBeNull();
  expect(sent.some(entry => entry.message.type === "error" && entry.message.message === "You already claimed a slot")).toBe(true);
});

test("start assigns the claimed slot to a human and leaves others as clock-spot bots", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "ot");
  session.start("c1");

  expect(session.world.players).toHaveLength(8);
  expect(session.world.players.find(player => player.id === "ot")?.control).toBe("human");
  expect(session.world.players.find(player => player.id === "mt")?.control).toBe("bot");

  // h2 is an unclaimed bot at its clock spot (3 o'clock)
  const bot = session.world.players.find(player => player.id === "h2");
  expect(bot?.control).toBe("bot");
  expect(bot?.pos).toEqual({ x: 8, z: 0 });
});

test("unclaimed clients do not enter the game on start", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.start("c1");

  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Claim a slot to join the running session")).toBe(true);
});

test("late joiner must claim before entering a running session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.join("c2");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);

  session.claimSlot("c2", "ot");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started" && entry.message.yourPlayerId === "ot")).toBe(true);
});

test("client can reclaim and enter a paused session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.step(false);
  const pausedTime = session.world.time;

  session.pause("c1");
  session.releaseSlot("c1", "mt");
  session.claimSlot("c1", "mt");

  expect(session.status).toBe("paused");
  expect(session.world.time).toBe(pausedTime);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt" && entry.message.world.time === pausedTime)).toBe(true);
});

test("host can resume a paused session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.pause("c1");

  session.play("c1");

  expect(session.status).toBe("running");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
});

test("client can reclaim and enter a stopped session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.step(false);

  session.stop("c1");
  session.releaseSlot("c1", "mt");
  session.claimSlot("c1", "mt");

  expect(session.status).toBe("stopped");
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt" && entry.message.world.time === 0)).toBe(true);
});

test("host can start again from a stopped lobby re-entry", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.stop("c1");
  session.releaseSlot("c1", "mt");
  session.claimObserver("c1");

  session.play("c1");

  expect(session.status).toBe("running");
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === null)).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
});

test("observers enter running sessions without occupying player slots", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.claimObserver("c2");

  expect(session.observers.has("c2")).toBe(true);
  expect([...session.slots.values()].filter(ownerId => ownerId !== null)).toHaveLength(1);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started" && entry.message.yourPlayerId === null)).toBe(true);
});

test("host can start as an observer without claiming a player slot", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimObserver("c1");

  session.start("c1");

  expect(session.status).toBe("running");
  expect([...session.slots.values()].every(ownerId => ownerId === null)).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === null)).toBe(true);
});

test("observer seats are capped at five", () => {
  const { session, sent } = makeSession();
  for (let i = 1; i <= MAX_OBSERVERS + 1; i++) {
    const clientId = `c${i}`;
    session.join(clientId);
    session.claimObserver(clientId);
  }

  expect(session.observers.size).toBe(MAX_OBSERVERS);
  expect(sent.some(entry => entry.clientId === `c${MAX_OBSERVERS + 1}` && entry.message.type === "error" && entry.message.message === "Observer seats are full")).toBe(true);
});

test("observers must leave observer mode before claiming a player slot", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimObserver("c1");

  session.claimSlot("c1", "mt");

  expect(session.observers.has("c1")).toBe(true);
  expect(session.slots.get("mt")).toBeNull();
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "error" && entry.message.message === "Leave observer mode before claiming a slot")).toBe(true);
});

test("claimed players use human intent while unclaimed patterned bots move", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setIntent("c1", { move: { x: 1, z: 0 } });
  for (let i = 0; i < 10; i++) session.step();

  const claimed = session.world.players.find(player => player.id === "mt")!;
  const patternedBot = session.world.players.find(player => player.id === "h1")!;
  const fallbackBot = session.world.players.find(player => player.id === "ot")!;

  expect(claimed.pos.x).toBeGreaterThan(0);
  expect(patternedBot.pos.x).toBeGreaterThan(0);
  expect(fallbackBot.pos).toEqual({ x: 0, z: -8 });
});

test("host can toggle bot invincibility without changing humans", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setBotsInvincible("c1", true);

  expect(session.world.players.find(player => player.id === "mt")?.invincible).toBe(false);
  expect(session.world.players.filter(player => player.control === "bot").every(player => player.invincible)).toBe(true);

  session.step(false);
  expect(session.world.players.filter(player => player.control === "bot").every(player => player.invincible)).toBe(true);

  session.restart("c1");
  expect(session.world.players.filter(player => player.control === "bot").every(player => player.invincible)).toBe(true);

  session.setBotsInvincible("c1", false);
  expect(session.world.players.some(player => player.control === "bot" && player.invincible)).toBe(false);
});

test("non-host cannot toggle bot invincibility", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setBotsInvincible("c2", true);

  expect(session.world.players.some(player => player.control === "bot" && player.invincible)).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Only the host can change bot invincibility")).toBe(true);
});

test("edge actions survive later movement intents before the next tick", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setIntent("c1", { move: { x: 0, z: 0 }, jump: true });
  session.setIntent("c1", { move: { x: 1, z: 0 } });
  session.step();

  const claimed = session.world.players.find(player => player.id === "mt")!;
  expect(claimed.y).toBeGreaterThan(0);
  expect(claimed.pos.x).toBeGreaterThan(0);
});

test("disconnect converts claimed slot back to bot", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");

  session.disconnect("c1");

  expect(session.slots.get("mt")).toBeNull();
  expect(session.world.players.find(player => player.id === "mt")?.control).toBe("bot");
});

test("host can switch raid in lobby and reset slot claims", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");

  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.raidId).toBe("alternate");
  expect(session.slots.has("mt")).toBe(true);
  expect([...session.slots.values()].every(ownerId => ownerId === null)).toBe(true);
  expect(sent.some(entry => entry.message.type === "lobby" && entry.message.raidId === "alternate")).toBe(true);
});

test("non-host cannot switch raid", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");

  session.setRaid("c2", "alternate", alternateRaid());

  expect(session.raidId).toBe("test-raid");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Only the host can change the raid")).toBe(true);
});

test("host cannot switch raid while playback is running", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.raidId).toBe("test-raid");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "error" && entry.message.message === "Stop or pause before changing raid")).toBe(true);
});

test("host can stop, switch raid, and keep a claimed player", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.stop("c1");
  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.status).toBe("running");
  expect(session.raidId).toBe("alternate");
  expect(session.slots.get("mt")).toBe("c1");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing" && entry.message.raidId === "alternate")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt")).toBe(true);
});

test("host can restart the current raid", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.step(false);

  expect(session.world.time).toBeGreaterThan(0);

  session.restart("c1");

  expect(session.status).toBe("running");
  expect(session.raidId).toBe("test-raid");
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt")).toBe(true);
});

test("host can restart after the session ends", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.restart("c1");

  expect(session.status).toBe("running");
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
});

test("host can stop after the session ends", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.stop("c1");

  expect(session.status).toBe("stopped");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "stopped")).toBe(true);
});

test("host can switch raid after the session ends", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.raidId).toBe("alternate");
  expect(session.status).toBe("running");
});

test("concurrent joins to a new session id create one session", async () => {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const manager = new SessionManager({
    raidsDir: "",
    send: (clientId, message) => sent.push({ clientId, message: typeof message === "string" ? JSON.parse(message) as ServerMessage : message }),
  });

  await Promise.all([
    manager.handle("c1", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID }),
    manager.handle("c2", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID }),
  ]);

  expect(manager.sessions.size).toBe(1);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "lobby")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "lobby")).toBe(true);
});

test("empty raid synthesizes the canonical eight slots", async () => {
  const raid = await loadSessionRaid(EMPTY_RAID_ID, "");
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new Session({
    id: "empty-room",
    raidId: EMPTY_RAID_ID,
    raid,
    send: (clientId, message) => sent.push({ clientId, message: typeof message === "string" ? JSON.parse(message) as ServerMessage : message }),
    autoTick: false,
  });

  expect(session.world.players.map(player => player.id)).toEqual(["mt", "ot", "h1", "h2", "r1", "r2", "m1", "m2"]);
  expect([...session.slots.values()]).toHaveLength(8);
  expect(sent).toHaveLength(0);
});

test("existing sessions join by session id after raid changes", async () => {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const manager = new SessionManager({
    raidsDir: "",
    send: (clientId, message) => sent.push({ clientId, message: typeof message === "string" ? JSON.parse(message) as ServerMessage : message }),
  });

  await manager.handle("c1", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID });
  const session = manager.sessions.get("room")!;
  session.setRaid("c1", "alternate", alternateRaid());

  await manager.handle("c2", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID });

  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "lobby" && entry.message.raidId === "alternate")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Session already uses a different raid")).toBe(false);
});

test("inactive lobby expires after configured timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now, lobbyTimeoutMs: 1000 });

  expect(session.isExpired()).toBe(false);
  now = 1000;
  expect(session.isExpired()).toBe(true);
});

test("finished session expires once idle past the timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now, lobbyTimeoutMs: 1000 });
  session.status = "done" as SessionStatus;

  expect(session.isExpired()).toBe(false);
  now = 1000;
  expect(session.isExpired()).toBe(true);
});

test("running session never expires by idle timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now, lobbyTimeoutMs: 1000 });
  session.status = "running";

  now = 60_000;
  expect(session.isExpired()).toBe(false);
});

test("client message schema rejects malformed intent packets", () => {
  const parsed = ClientMessageSchema.safeParse({
    type: "intent",
    intent: { move: { x: Number.NaN, z: 0 } },
  });

  expect(parsed.success).toBe(false);
});

test("client message schema rejects out-of-range intent magnitudes", () => {
  const parsed = ClientMessageSchema.safeParse({
    type: "intent",
    intent: { move: { x: 1e9, z: 0 } },
  });

  expect(parsed.success).toBe(false);
});

test("client message schema accepts bot invincibility toggle", () => {
  const parsed = ClientMessageSchema.safeParse({ type: "setBotsInvincible", enabled: true });

  expect(parsed.success).toBe(true);
});
