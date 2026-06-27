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
