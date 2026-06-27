import { expect, test } from "bun:test";
import { loadRaid } from "../engine/raidLoader";
import { baseRaid, roster } from "../engine/__tests__/helpers";
import { ClientMessageSchema, EMPTY_RAID_ID, MAX_OBSERVERS } from "@shared/protocol";
import type { ServerMessage } from "@shared/protocol";
import { capacitySnapshot, EMPTY_LOBBY_TIMEOUT_MS, LOBBY_TIMEOUT_MS, RelayRoom, type SessionStatus } from "./relayRoom";
import { createEmptyRaid, loadSessionRaid } from "./sessionRaid";

// Session test raids reuse the shared canonical roster builder (clock spots from shared/protocol) so
// spawns stay in sync with the engine; only the arena/duration and a couple of spawn overrides differ.
const sessionArena = { zones: [{ kind: "circle" as const, center: [0, 0] as [number, number], radius: 30 }] };

function testRaid() {
  return loadRaid({
    ...baseRaid,
    name: "Session Test",
    arena: sessionArena,
    duration: 30,
    players: roster({
      mt: { spawn: [0, 0] },
      h1: { spawn: [0, 0], pattern: [{ t: 0, pos: [5, 0] }] },
    }),
  });
}

function alternateRaid() {
  return loadRaid({ ...baseRaid, name: "Alternate Test", arena: sessionArena, duration: 30, players: roster() });
}

function makeSession(options: { now?: () => number; lobbyTimeoutMs?: number } = {}) {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new RelayRoom();
  session.initForTest({
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

function makeDefaultLobbySession() {
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new RelayRoom();
  session.initForTest({
    id: "default-room",
    raidId: EMPTY_RAID_ID,
    raid: createEmptyRaid(),
    send: (clientId, message) => sent.push({ clientId, message: typeof message === "string" ? JSON.parse(message) as ServerMessage : message }),
    autoTick: false,
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

test("late joiner cannot enter a running session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.join("c2");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);

  session.claimSlot("c2", "ot");
  expect(session.slots.get("ot")).toBeNull();
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(true);
});

test("default lobby remains joinable while running", () => {
  const { session, sent } = makeDefaultLobbySession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.join("c2");
  session.claimSlot("c2", "ot");

  expect(session.raidId).toBe(EMPTY_RAID_ID);
  expect(session.status).toBe("running");
  expect(session.slots.get("ot")).toBe("c2");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started" && entry.message.yourPlayerId === "ot")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(false);
});

test("default lobby observers can enter while running", () => {
  const { session, sent } = makeDefaultLobbySession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.join("c2");
  session.claimObserver("c2");

  expect(session.observers.has("c2")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started" && entry.message.yourPlayerId === null)).toBe(true);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(false);
});

test("client cannot reclaim and enter a paused session", () => {
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
  expect(session.slots.get("mt")).toBeNull();
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(true);
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

test("host leaving to the lobby stops the session without bouncing the host, and resets other clients", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.join("c2");
  session.claimObserver("c2");
  session.start("c1");
  session.step(false);

  const hostStartedBefore = sent.filter(entry => entry.clientId === "c1" && entry.message.type === "started").length;
  const otherStartedBefore = sent.filter(entry => entry.clientId === "c2" && entry.message.type === "started").length;

  session.leave("c1");

  expect(session.status).toBe("stopped");
  // The leaving host gets no new "started" (showLobby would treat it as a re-entry and bounce it back
  // into a stale sim); the remaining clients are reset to the frozen world.
  expect(sent.filter(entry => entry.clientId === "c1" && entry.message.type === "started").length).toBe(hostStartedBefore);
  expect(sent.filter(entry => entry.clientId === "c2" && entry.message.type === "started").length).toBe(otherStartedBefore + 1);

  // The host still owns its slot, so the releaseSlot that Home sends next succeeds. Regression: with a
  // plain stop(), the host was bounced back in and the slot was freed, so this rejected with
  // "You do not own that slot".
  session.releaseSlot("c1", "mt");
  expect(session.slots.get("mt")).toBeNull();
  expect(sent.some(entry => entry.message.type === "error" && entry.message.message === "You do not own that slot")).toBe(false);
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

test("observers cannot enter running sessions", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.claimObserver("c2");

  expect(session.observers.has("c2")).toBe(false);
  expect([...session.slots.values()].filter(ownerId => ownerId !== null)).toHaveLength(1);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(true);
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

test("relayed frames carry only human intents; bots are derived client-side", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setIntent("c1", { move: { x: 1, z: 0 } });
  session.step();

  expect(session.inputLog).toHaveLength(1);
  const frame = session.inputLog[0];
  expect(frame.intents.mt?.move).toEqual({ x: 1, z: 0 });
  expect(frame.intents.ot).toBeUndefined(); // unclaimed bots are not in the frame
  expect(frame.intents.h1).toBeUndefined();

  const framesMsg = sent.find(entry => entry.clientId === "c1" && entry.message.type === "frames");
  expect(framesMsg?.message).toMatchObject({ type: "frames", startTick: 0 });
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

test("edge actions survive later movement intents within the same tick's frame", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");

  session.setIntent("c1", { move: { x: 0, z: 0 }, jump: true });
  session.setIntent("c1", { move: { x: 1, z: 0 } });
  session.step();

  const intent = session.inputLog[0].intents.mt!;
  expect(intent.jump).toBe(true);
  expect(intent.move).toEqual({ x: 1, z: 0 });
});

test("disconnect converts claimed slot back to bot", () => {
  const { session } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");

  session.disconnectClient("c1");

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

  expect(session.inputLog.length).toBeGreaterThan(0);

  session.restart("c1");

  expect(session.status).toBe("running");
  expect(session.raidId).toBe("test-raid");
  expect(session.inputLog).toHaveLength(0);
  expect(session.world.time).toBe(0);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "playback" && entry.message.state === "playing")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt")).toBe(true);
});

test("late joiner is not fast-forwarded into a running pull", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.setIntent("c1", { move: { x: 1, z: 0 } });
  session.step(false);
  session.step(false);

  session.join("c2");
  session.claimSlot("c2", "ot");

  expect(session.slots.get("ot")).toBeNull();
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "started")).toBe(false);
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error" && entry.message.message === "Wait for the next pull to join")).toBe(true);
});

test("snapshot anchor: late join after host snapshot is still rejected", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  for (let i = 0; i < 5; i++) session.step(false);

  // Host submits a snapshot at tick 3
  session.handle("c1", { type: "snapshot", tick: 3, world: { arena: {}, players: [], sentinel: true } });

  session.join("c2");
  session.claimSlot("c2", "ot");

  expect(session.slots.get("ot")).toBeNull();
  expect(sent.some(e => e.clientId === "c2" && e.message.type === "started")).toBe(false);
  expect(sent.some(e => e.clientId === "c2" && e.message.type === "error" && e.message.message === "Wait for the next pull to join")).toBe(true);
});

test("snapshot anchor: desync resync uses snapshot + tail", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  for (let i = 0; i < 5; i++) session.step(false);

  session.handle("c1", { type: "snapshot", tick: 3, world: { arena: {}, players: [], sentinel: true } });

  // Trigger a resync for c2 via mismatched hash
  session.reportWorldHash("c1", 1, 111);
  const beforeResync = sent.filter(e => e.clientId === "c2" && e.message.type === "started").length;
  session.reportWorldHash("c2", 1, 222);

  const resyncs = sent.filter(e => e.clientId === "c2" && e.message.type === "started");
  expect(resyncs).toHaveLength(beforeResync + 1);
  const msg = resyncs[resyncs.length - 1].message as Extract<ServerMessage, { type: "started" }>;
  expect(msg.baseTick).toBe(3);
  expect(msg.frames).toHaveLength(2);
});

test("snapshot anchor: non-host snapshot is rejected", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  for (let i = 0; i < 3; i++) session.step(false);

  // c2 is not the host — snapshot must be ignored
  session.handle("c2", { type: "snapshot", tick: 2, world: { arena: {}, players: [], sentinel: true } });

  session.reportWorldHash("c1", 1, 111);
  const beforeResync = sent.filter(e => e.clientId === "c2" && e.message.type === "started").length;
  session.reportWorldHash("c2", 1, 222);

  const resyncs = sent.filter(e => e.clientId === "c2" && e.message.type === "started");
  expect(resyncs).toHaveLength(beforeResync + 1);
  const msg = resyncs[resyncs.length - 1].message as Extract<ServerMessage, { type: "started" }>;
  expect(msg.baseTick).toBe(0);
  expect(msg.frames).toHaveLength(3); // full log, no anchor
});

test("snapshot anchor: resetPull clears the snapshot", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  for (let i = 0; i < 5; i++) session.step(false);

  session.handle("c1", { type: "snapshot", tick: 3, world: { arena: {}, players: [], sentinel: true } });

  // Restart resets the pull — snapshot must be cleared
  const beforeRestart = sent.filter(e => e.clientId === "c2" && e.message.type === "started").length;
  session.restart("c1");

  const started = sent.filter(e => e.clientId === "c2" && e.message.type === "started");
  expect(started).toHaveLength(beforeRestart + 1);
  const msg = started[started.length - 1].message as Extract<ServerMessage, { type: "started" }>;
  expect(msg.baseTick).toBe(0); // snapshot was cleared by restart
  expect(msg.frames).toHaveLength(0);
});

test("snapshot anchor: monotonic — older snapshot does not replace newer", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  for (let i = 0; i < 5; i++) session.step(false);

  session.handle("c1", { type: "snapshot", tick: 4, world: { arena: {}, players: [], snap: "new" } });
  session.handle("c1", { type: "snapshot", tick: 2, world: { arena: {}, players: [], snap: "old" } }); // older — must be ignored

  session.reportWorldHash("c1", 1, 111);
  const beforeResync = sent.filter(e => e.clientId === "c2" && e.message.type === "started").length;
  session.reportWorldHash("c2", 1, 222);

  const resyncs = sent.filter(e => e.clientId === "c2" && e.message.type === "started");
  expect(resyncs).toHaveLength(beforeResync + 1);
  const msg = resyncs[resyncs.length - 1].message as Extract<ServerMessage, { type: "started" }>;
  expect(msg.baseTick).toBe(4);
  expect((msg.world as any)?.snap).toBe("new");
});

test("snapshot anchor: malformed world is rejected (falls back to full log)", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  for (let i = 0; i < 5; i++) session.step(false);

  // Missing arena/players — must not be stored, so a later join falls back to full-log anchoring.
  session.handle("c1", { type: "snapshot", tick: 3, world: { bogus: true } });

  session.reportWorldHash("c1", 1, 111);
  const beforeResync = sent.filter(e => e.clientId === "c2" && e.message.type === "started").length;
  session.reportWorldHash("c2", 1, 222);

  const resyncs = sent.filter(e => e.clientId === "c2" && e.message.type === "started");
  expect(resyncs).toHaveLength(beforeResync + 1);
  const msg = resyncs[resyncs.length - 1].message as Extract<ServerMessage, { type: "started" }>;
  expect(msg.baseTick).toBe(0);
  expect(msg.frames).toHaveLength(5);
});

test("only the host can end the session via simEnded", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");

  session.simEnded("c2", 5);
  expect(session.status).toBe("running");
  expect(sent.some(entry => entry.clientId === "c2" && entry.message.type === "error")).toBe(true);

  session.simEnded("c1", 5);
  expect(session.status).toBe("done");
  expect(sent.some(entry => entry.message.type === "playback" && entry.message.state === "done")).toBe(true);
});

test("divergent world hashes for a tick resync the offending client", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  session.step(false);

  session.reportWorldHash("c1", 1, 111); // first hash for tick 1 is canonical
  const before = sent.filter(entry => entry.clientId === "c2" && entry.message.type === "started").length;
  session.reportWorldHash("c2", 1, 222); // mismatch -> resend started + log to c2

  const after = sent.filter(entry => entry.clientId === "c2" && entry.message.type === "started").length;
  expect(after).toBe(before + 1);
});

test("matching world hashes do not resync", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.join("c2");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.start("c1");
  session.step(false);

  session.reportWorldHash("c1", 1, 999); // canonical
  const before = sent.filter(entry => entry.message.type === "started").length;
  session.reportWorldHash("c2", 1, 999); // agrees -> no resync
  expect(sent.filter(entry => entry.message.type === "started").length).toBe(before);
});

test("non-host report before the host's is buffered, then judged against the host's hash", () => {
  const { session, sent } = makeSession();
  session.join("c1"); // host
  session.join("c2");
  session.join("c3");
  session.claimSlot("c1", "mt");
  session.claimSlot("c2", "ot");
  session.claimSlot("c3", "h1");
  session.start("c1");
  session.step(false);

  // A desynced client reports first, before the host — must be buffered, not acted on yet.
  session.reportWorldHash("c2", 1, 222);
  session.reportWorldHash("c3", 1, 999); // honest, agrees with the (not-yet-known) host hash
  const startedBefore = (id: string) => sent.filter(e => e.clientId === id && e.message.type === "started").length;
  const c2Before = startedBefore("c2");
  const c3Before = startedBefore("c3");

  // Host's hash lands and becomes canonical: the buffered desynced client is resynced, the honest one is not.
  session.reportWorldHash("c1", 1, 999);
  expect(startedBefore("c2")).toBe(c2Before + 1);
  expect(startedBefore("c3")).toBe(c3Before);
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

test("client can re-enter after leaving a finished session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimSlot("c1", "mt");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.releaseSlot("c1", "mt");
  session.claimSlot("c1", "mt");

  expect(session.status).toBe("done");
  expect(session.slots.get("mt")).toBe("c1");
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === "mt")).toBe(true);
});

test("observer can re-enter after leaving a finished session", () => {
  const { session, sent } = makeSession();
  session.join("c1");
  session.claimObserver("c1");
  session.start("c1");
  session.status = "done" as SessionStatus;

  session.releaseObserver("c1");
  session.claimObserver("c1");

  expect(session.status).toBe("done");
  expect(session.observers.has("c1")).toBe(true);
  expect(sent.some(entry => entry.clientId === "c1" && entry.message.type === "started" && entry.message.yourPlayerId === null)).toBe(true);
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


test("empty raid synthesizes the canonical eight slots", async () => {
  const raid = await loadSessionRaid(EMPTY_RAID_ID, "");
  const sent: Array<{ clientId: string; message: ServerMessage }> = [];
  const session = new RelayRoom();
  session.initForTest({
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

test("auth accepts Bun Headers from Colyseus websocket context", () => {
  const { session } = makeSession();
  const client = {} as any;

  expect(session.onAuth(client, {}, {
    headers: new Headers({ origin: "http://localhost:34567", host: "localhost:34567" }),
    ip: "127.0.0.1",
  } as any)).toBe(true);
  expect(client.userData?.ip).toBe("127.0.0.1");
});


test("inactive lobby expires after configured timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now, lobbyTimeoutMs: 1000 });

  expect(session.isExpired()).toBe(false);
  now = 1000;
  expect(session.isExpired()).toBe(true);
});

test("an unused lobby expires on the shorter empty timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now });

  expect(session.isExpired()).toBe(false);
  now = EMPTY_LOBBY_TIMEOUT_MS;
  expect(session.isExpired()).toBe(true);
});

test("claiming a slot keeps the lobby on the full timeout", () => {
  let now = 0;
  const { session } = makeSession({ now: () => now });
  session.join("c1");
  session.claimSlot("c1", "mt");

  now = EMPTY_LOBBY_TIMEOUT_MS;
  expect(session.isExpired()).toBe(false);
  now = LOBBY_TIMEOUT_MS;
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

test("capacity snapshot reports availability", () => {
  expect(capacitySnapshot(3, 10)).toEqual({ sessions: 3, maxSessions: 10, availableSessions: 7 });
});

test("capacity snapshot clamps availability at zero", () => {
  expect(capacitySnapshot(12, 10)).toEqual({ sessions: 12, maxSessions: 10, availableSessions: 0 });
});

test("client message schema accepts bot invincibility toggle", () => {
  const parsed = ClientMessageSchema.safeParse({ type: "setBotsInvincible", enabled: true });

  expect(parsed.success).toBe(true);
});
