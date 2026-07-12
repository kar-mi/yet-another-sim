import { expect, test } from "bun:test";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import type { Transport } from "../net";
import { NetClient } from "../net";
import { createWorld } from "../../engine/world";
import { createEmptyRaid } from "../../server/sessionRaid";

class FakeTransport implements Transport {
  readonly sent: ClientMessage[] = [];
  private messageHandler: (message: ServerMessage) => void = () => {};
  private reconnectHandler: () => void = () => {};
  open(): Promise<void> { return Promise.resolve(); }
  send(message: ClientMessage): boolean { this.sent.push(message); return true; }
  onMessage(cb: (message: ServerMessage) => void): void { this.messageHandler = cb; }
  onReconnect(cb: () => void): void { this.reconnectHandler = cb; }
  close(): void {}
  emit(message: ServerMessage): void { this.messageHandler(message); }
  reconnect(): void { this.reconnectHandler(); }
}

test("NetClient adopts started data and requests a rejoin when frames have a gap", () => {
  const transport = new FakeTransport();
  const client = new NetClient(transport);
  client.send({ type: "join", sessionId: "session", raidId: "empty" });
  transport.emit({ type: "started", world: createWorld(createEmptyRaid(), 123), baseTick: 0, yourPlayerId: null, tick: 0, frames: [] });
  expect(client.getRenderView(performance.now())).not.toBeNull();

  transport.emit({ type: "frames", startTick: 1, frames: [{ intents: {}, botsInvincible: false }] });
  expect(transport.sent.filter(message => message.type === "join")).toHaveLength(2);
});

test("NetClient reconnect restores its join and claimed slot", () => {
  const transport = new FakeTransport();
  const client = new NetClient(transport);
  client.send({ type: "join", sessionId: "session", raidId: "empty" });
  client.send({ type: "claimSlot", playerId: "mt" });
  transport.reconnect();
  expect(transport.sent.slice(-2)).toEqual([
    { type: "join", sessionId: "session", raidId: "empty" },
    { type: "claimSlot", playerId: "mt" },
  ]);
});

test("NetClient reconnect restores observer mode after a local claim", () => {
  const transport = new FakeTransport();
  const client = new NetClient(transport);
  client.send({ type: "join", sessionId: "session", raidId: "empty" });
  client.send({ type: "claimObserver" });
  transport.reconnect();
  expect(transport.sent.slice(-2)).toEqual([
    { type: "join", sessionId: "session", raidId: "empty" },
    { type: "claimObserver" },
  ]);
});
