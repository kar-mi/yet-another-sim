import { expect, test } from "bun:test";
import type { ClientMessage, Frame, ServerMessage } from "@model/protocol";
import type { Transport } from "../net";
import { NetClient } from "../net";
import { SimulationReplica } from "../simulationReplica";
import { worldHash } from "@model/worldHash";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";

const PARTICIPANT = "11111111-2222-3333-4444-555555555555";
const IDLE_FRAME: Frame = { intents: {}, botsInvincible: false };

class FakeTransport implements Transport {
  readonly sent: ClientMessage[] = [];
  closed = 0;
  private messageHandler: (message: ServerMessage) => void = () => {};
  private disconnectHandler: () => void = () => {};
  open(): Promise<void> { return Promise.resolve(); }
  send(message: ClientMessage): boolean { this.sent.push(message); return true; }
  onMessage(cb: (message: ServerMessage) => void): void { this.messageHandler = cb; }
  onDisconnect(cb: () => void): void { this.disconnectHandler = cb; }
  close(): void { this.closed++; }
  ping(): void {}
  emit(message: ServerMessage): void { this.messageHandler(message); }
  disconnect(): void { this.disconnectHandler(); }
}

function startedClient(options: { host?: boolean; pull?: number } = {}) {
  const transport = new FakeTransport();
  const client = new NetClient(transport);
  const expired: ServerMessage[] = [];
  client.on("sessionExpired", message => expired.push(message));
  client.send({ type: "join", sessionId: "session", raidId: "empty", participantId: PARTICIPANT });
  transport.emit({ type: "joined", participantId: PARTICIPANT });
  if (options.host) {
    transport.emit({ type: "playback", state: "playing", phase: "workshop", raidId: "empty", hostParticipantId: PARTICIPANT, rngDecisions: [] });
  }
  const world = createWorld(createEmptyRaid(), 123);
  transport.emit({ type: "started", pull: options.pull ?? 1, world, baseTick: 0, yourPlayerId: null, tick: 0, frames: [] });
  return { transport, client, world, expired };
}

function feed(transport: FakeTransport, startTick: number, count: number): void {
  transport.emit({ type: "frames", startTick, frames: Array.from({ length: count }, () => IDLE_FRAME) });
}

test("a frame gap ends the session instead of rejoining", () => {
  const { transport, client, expired } = startedClient();
  expect(client.getRenderView(performance.now())).not.toBeNull();

  feed(transport, 1, 1);

  expect(transport.sent.filter(message => message.type === "join")).toHaveLength(1);
  expect(expired).toHaveLength(1);
  expect(transport.closed).toBeGreaterThan(0);
  expect(client.getRenderView(performance.now())).toBeNull();
});

test("an unexpected disconnect ends the session instead of rejoining", () => {
  const { transport, expired } = startedClient();
  transport.disconnect();
  expect(transport.sent.filter(message => message.type === "join")).toHaveLength(1);
  expect(expired).toHaveLength(1);
});

test("a frame batch spanning the hash boundary reports that tick's hash once, tagged with the pull", () => {
  const { transport, world } = startedClient({ pull: 7 });
  feed(transport, 0, 298);
  feed(transport, 298, 3);

  const reference = new SimulationReplica();
  reference.adopt(world, 0, Array.from({ length: 300 }, () => IDLE_FRAME));
  const hashes = transport.sent.filter(message => message.type === "worldHash");
  expect(hashes).toEqual([{ type: "worldHash", pull: 7, tick: 300, hash: worldHash(reference.world!) }]);
});

test("a frame batch ending on the hash boundary reports it once", () => {
  const { transport } = startedClient();
  feed(transport, 0, 298);
  feed(transport, 298, 2);
  expect(transport.sent.filter(message => message.type === "worldHash").map(message => message.type === "worldHash" && message.tick)).toEqual([300]);
});

test("the host snapshots the boundary tick when a batch spans it", () => {
  const { transport } = startedClient({ host: true, pull: 3 });
  feed(transport, 0, 599);
  feed(transport, 599, 3);
  const snapshots = transport.sent.filter(message => message.type === "snapshot");
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0]).toMatchObject({ type: "snapshot", pull: 3, tick: 600 });
  expect(((snapshots[0] as Extract<ClientMessage, { type: "snapshot" }>).world as { time: number }).time).toBeCloseTo(10);
});
