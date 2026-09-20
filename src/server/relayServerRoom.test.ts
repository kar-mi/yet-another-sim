import { expect, test } from "bun:test";
import { RelayServerRoom } from "./relayServerRoom";

const PARTICIPANT = "11111111-2222-3333-4444-555555555555";

test("auth accepts Bun Headers from Colyseus websocket context", () => {
  const room = new RelayServerRoom();
  const client = {} as any;

  expect(room.onAuth(client, { participantId: PARTICIPANT }, {
    headers: new Headers({ origin: "http://localhost:34567", host: "localhost:34567" }),
    ip: "127.0.0.1",
  } as any)).toBe(true);
  expect(client.userData?.ip).toBe("127.0.0.1");
  expect(client.userData?.participantId).toBe(PARTICIPANT);
});

test("auth rejects a missing or malformed participant id", () => {
  const room = new RelayServerRoom();
  const context = {
    headers: new Headers({ origin: "http://localhost:34567", host: "localhost:34567" }),
    ip: "127.0.0.1",
  } as any;

  expect(room.onAuth({} as any, {}, context)).toBe(false);
  expect(room.onAuth({} as any, { participantId: "../../etc/passwd" }, context)).toBe(false);
});

test("onCreate rejects a path-traversal raidId", async () => {
  const room = new RelayServerRoom() as any;
  room.roomId = "test-room";
  room.setMetadata = async () => {};
  room.clock = { setInterval: () => 0 };

  await expect(room.onCreate({ sessionId: "test-room", raidId: "../../etc/passwd" }))
    .rejects.toThrow();
});

test("colyseus messages reach the relay", async () => {
  const sent: any[] = [];
  const room = new RelayServerRoom({ autoTick: false }) as any;
  room.roomId = "test-room";
  room.setMetadata = async () => {};
  room.clock = { setInterval: () => 0 };

  const client = {
    sessionId: "c1",
    userData: { ip: "127.0.0.1", rate: { allow: () => true }, counted: true, participantId: PARTICIPANT },
    send: (_type: string, message: any) => sent.push(message),
    leave: () => {},
  };
  room.clients = [client];
  room.clients.getById = (id: string) => id === client.sessionId ? client : undefined;

  await room.onCreate({ sessionId: "test-room", raidId: "empty" });
  room.onJoin(client);
  room.handleColyseusMessage(client, { type: "claimSlot", playerId: "mt" });
  await room.messageQueue;
  room.handleColyseusMessage(client, { type: "enterWorkshop" });
  await room.messageQueue;

  expect(sent.some(message => message.type === "started" && message.yourPlayerId === "mt")).toBe(true);
});
