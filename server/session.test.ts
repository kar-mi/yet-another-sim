import { expect, test } from "bun:test";
import { loadRaid } from "../src/engine/raidLoader";
import { ClientMessageSchema, EMPTY_RAID_ID } from "../src/shared/protocol";
import type { ServerMessage } from "../src/shared/protocol";
import { loadSessionRaid, Session, SessionManager, type SessionStatus } from "./session";

function testRaid() {
  return loadRaid({
    name: "Session Test",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
    duration: 30,
    players: [
      { id: "p1", role: "tank", control: "human", spawn: [0, 0] },
      { id: "p2", role: "healer", control: "bot", spawn: [0, 0], pattern: [{ t: 0, pos: [5, 0] }] },
    ],
    events: [],
  });
}

function alternateRaid() {
  return loadRaid({
    name: "Alternate Test",
    arena: { zones: [{ kind: "circle", center: [0, 0], radius: 30 }] },
    duration: 30,
    players: [
      { id: "q1", role: "tank", control: "human", spawn: [0, 0] },
      { id: "q2", role: "healer", control: "bot", spawn: [0, 0] },
    ],
    events: [],
  });
}

function makeSession(options: { now?: () => number; lobbyTimeoutMs?: number } = {}) {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new Session({
    id: "test-room",
    raidId: "test-raid",
    raid: testRaid(),
    send: (clientId, message) => sent.push({ clientId, message }),
    autoTick: false,
    now: options.now,
    lobbyTimeoutMs: options.lobbyTimeoutMs,
  });
  return { session, sent };
}

test("client can claim only one slot", () => {
  const { session, sent } = makeSession();
  session.join("c1");

  session.claimSlot("c1", "p1");
  session.claimSlot("c1", "p2");

  expect(session.slots.get("p1")).toBe("c1");
  expect(session.slots.get("p2")).toBeNull();
  expect(sent.some(entry => entry.message.type === "error" && entry.message.message === "You already claimed a slot")).toBe(true);
});

test("start preserves lobby assignments and fills missing slots with idle center bots", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p2");
  session.start("c1");

  expect(session.world.players).toHaveLength(8);
  expect(session.world.players.find(player => player.id === "p2")?.control).toBe("human");
  expect(session.world.players.find(player => player.id === "p1")?.control).toBe("bot");

  const fallback = session.world.players.find(player => player.id === "p3");
  expect(fallback?.control).toBe("bot");
  expect(fallback?.pos).toEqual({ x: 0, z: 0 });
});

test("unclaimed clients do not enter the game on start", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "p1");
  session.start("c1");

  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "p1")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Claim a slot to join the running session")).toBe(true);
});

test("late joiner must claim before entering a running session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
  session.start("c1");

  session.join("c2");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);

  session.claimSlot("c2", "p2");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started" && entry.message.yourPlayerId === "p2")).toBe(true);
});

test("claimed players use human intent while unclaimed patterned bots move", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
  session.start("c1");

  session.setIntent("c1", { move: { x: 1, z: 0 } });
  for (let i = 0; i < 10; i++) session.step();

  const claimed = session.world.players.find(player => player.id === "p1")!;
  const patternedBot = session.world.players.find(player => player.id === "p2")!;
  const fallbackBot = session.world.players.find(player => player.id === "p3")!;

  expect(claimed.pos.x).toBeGreaterThan(0);
  expect(patternedBot.pos.x).toBeGreaterThan(0);
  expect(fallbackBot.pos).toEqual({ x: 0, z: 0 });
});

test("edge actions survive later movement intents before the next tick", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
  session.start("c1");

  session.setIntent("c1", { move: { x: 0, z: 0 }, jump: true });
  session.setIntent("c1", { move: { x: 1, z: 0 } });
  session.step();

  const claimed = session.world.players.find(player => player.id === "p1")!;
  expect(claimed.y).toBeGreaterThan(0);
  expect(claimed.pos.x).toBeGreaterThan(0);
});

test("disconnect converts claimed slot back to bot", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");

  session.disconnect("c1");

  expect(session.slots.get("p1")).toBeNull();
  expect(session.world.players.find(player => player.id === "p1")?.control).toBe("bot");
});

test("host can switch raid in lobby and reset slot claims", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");

  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.raidId).toBe("alternate");
  expect(session.slots.has("q1")).toBe(true);
  expect(session.slots.has("p1")).toBe(false);
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
  session.claimSlot("c1", "p1");
  session.start("c1");

  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.raidId).toBe("test-raid");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "error" && entry.message.message === "Stop or pause before changing raid")).toBe(true);
});

test("host can stop, switch raid, and keep a claimed player", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
  session.start("c1");

  session.stop("c1");
  session.setRaid("c1", "alternate", alternateRaid());

  expect(session.status).toBe("running");
  expect(session.raidId).toBe("alternate");
  expect(session.slots.get("q1")).toBe("c1");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing" && entry.message.raidId === "alternate")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "q1")).toBe(true);
});

test("host can restart the current raid", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
  session.start("c1");
  session.step(false);

  expect(session.world.time).toBeGreaterThan(0);

  session.restart("c1");

  expect(session.status).toBe("running");
  expect(session.raidId).toBe("test-raid");
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "p1")).toBe(true);
});

test("host can restart after the session ends", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
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
  session.claimSlot("c1", "p1");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.stop("c1");

  expect(session.status).toBe("stopped");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "stopped")).toBe(true);
});

test("host can switch raid after the session ends", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "p1");
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
    send: (clientId, message) => sent.push({ clientId, message }),
  });

  await Promise.all([
    manager.handle("c1", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID }),
    manager.handle("c2", { type: "join", sessionId: "room", raidId: EMPTY_RAID_ID }),
  ]);

  expect(manager.sessions.size).toBe(1);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "lobby")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "lobby")).toBe(true);
});

test("empty raid synthesizes eight generic slots", async () => {
  const raid = await loadSessionRaid(EMPTY_RAID_ID, "");
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new Session({
    id: "empty-room",
    raidId: EMPTY_RAID_ID,
    raid,
    send: (clientId, message) => sent.push({ clientId, message }),
    autoTick: false,
  });

  expect(session.world.players.map(player => player.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]);
  expect([...session.slots.values()]).toHaveLength(8);
  expect(sent).toHaveLength(0);
});

test("existing sessions join by session id after raid changes", async () => {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const manager = new SessionManager({
    raidsDir: "",
    send: (clientId, message) => sent.push({ clientId, message }),
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
