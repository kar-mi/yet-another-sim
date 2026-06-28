import { expect, test } from "bun:test";
import { RelayServerRoom } from "./relayServerRoom";

test("auth accepts Bun Headers from Colyseus websocket context", () => {
  const room = new RelayServerRoom();
  const client = {} as any;

  expect(room.onAuth(client, {}, {
    headers: new Headers({ origin: "http://localhost:34567", host: "localhost:34567" }),
    ip: "127.0.0.1",
  } as any)).toBe(true);
  expect(client.userData?.ip).toBe("127.0.0.1");
});

test("colyseus messages reach the relay", async () => {
  const sent: any[] = [];
  const room = new RelayServerRoom() as any;
  room.roomId = "test-room";
  room.setMetadata = async () => {};
  room.clock = { setInterval: () => 0 };

  const client = {
    sessionId: "c1",
    userData: { ip: "127.0.0.1", rate: { allow: () => true }, counted: true },
    send: (_type: string, message: any) => sent.push(message),
    leave: () => {},
  };
  room.clients = [client];
  room.clients.getById = (id: string) => id === client.sessionId ? client : undefined;

  await room.onCreate({ sessionId: "test-room", raidId: "empty", autoTick: false });
  room.onJoin(client);
  room.handleColyseusMessage(client, { type: "claimSlot", playerId: "mt" });
  await Promise.resolve();
  room.handleColyseusMessage(client, { type: "start" });
  await Promise.resolve();

  expect(sent.some(message => message.type === "started" && message.yourPlayerId === "mt")).toBe(true);
});
