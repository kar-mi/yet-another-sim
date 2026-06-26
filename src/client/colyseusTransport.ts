import { Client, type Room } from "colyseus.js";
import type { ClientMessage, ServerMessage } from "@shared/protocol";
import type { Transport } from "./net";

export class ColyseusTransport implements Transport {
  private client: Client | null = null;
  private room: Room | null = null;
  private messageHandler: (message: ServerMessage) => void = () => {};
  private reconnectHandler: () => void = () => {};
  private closing = false;

  constructor(private readonly url: string) {}

  async open(): Promise<void> {
    this.client = new Client(this.url);
  }

  send(message: ClientMessage): boolean {
    if (message.type === "join") {
      void this.join(message.sessionId, message.raidId);
      return true;
    }
    if (!this.room) return false;
    this.room.send("c", message);
    return true;
  }

  onMessage(cb: (message: ServerMessage) => void): void {
    this.messageHandler = cb;
  }

  onReconnect(cb: () => void): void {
    this.reconnectHandler = cb;
  }

  close(): void {
    this.closing = true;
    void this.room?.leave(true);
    this.room = null;
  }

  private async join(sessionId: string, raidId: string): Promise<void> {
    if (!this.client) return;
    this.closing = false;
    if (this.room) await this.room.leave(true);
    const room = await this.client.joinOrCreate("relay", { sessionId, raidId });
    this.room = room;
    room.onMessage("s", message => this.messageHandler(message as ServerMessage));
    room.onLeave(() => {
      if (this.room === room) this.room = null;
      if (!this.closing) this.reconnectHandler();
    });
  }
}
