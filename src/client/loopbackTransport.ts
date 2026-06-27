import { applyBotPatterns, loadBotPatterns, loadRaid } from "../engine/raidLoader";
import { RelayRoom } from "../server/relayRoom";
import { createEmptyRaid } from "../server/sessionRaid";
import { EMPTY_RAID_ID, type ClientMessage, type ServerMessage } from "@shared/protocol";
import type { RaidDef } from "../engine/raidSchema";
import type { Transport } from "./net";
import { RAID_DEFS } from "./staticRaids.generated";

export class LoopbackTransport implements Transport {
  private readonly clientId = crypto.randomUUID();
  private room: RelayRoom | null = null;
  private roomSessionId = "";
  private messageHandler: (message: ServerMessage) => void = () => {};

  open(): Promise<void> {
    return Promise.resolve();
  }

  send(message: ClientMessage): boolean {
    void this.dispatch(message);
    return true;
  }

  onMessage(cb: (message: ServerMessage) => void): void {
    this.messageHandler = cb;
  }

  onReconnect(_cb: () => void): void {}

  close(): void {
    this.room?.disconnectClient(this.clientId);
    this.room = null;
  }

  private async dispatch(message: ClientMessage): Promise<void> {
    if (message.type === "join") {
      if (!this.room || this.roomSessionId !== message.sessionId) {
        this.room?.disconnectClient(this.clientId);
        this.room = new RelayRoom();
        this.roomSessionId = message.sessionId;
        this.room.init({
          id: message.sessionId,
          raidId: message.raidId,
          raid: await this.loadRaid(message.raidId),
          send: (_clientId, outbound) => this.messageHandler(this.normalize(outbound)),
        });
        this.messageHandler({ type: "joined", clientId: this.clientId });
        this.room.join(this.clientId);
      } else {
        this.room.join(this.clientId);
      }
      return;
    }
    if (!this.room) return;
    if (message.type === "setRaid") {
      this.room.setRaid(this.clientId, message.raidId, await this.loadRaid(message.raidId));
      return;
    }
    this.room.handle(this.clientId, message);
  }

  private normalize(message: ServerMessage | string): ServerMessage {
    return typeof message === "string" ? JSON.parse(message) as ServerMessage : message;
  }

  private async loadRaid(raidId: string): Promise<RaidDef> {
    if (raidId === EMPTY_RAID_ID) return createEmptyRaid();
    const definition = RAID_DEFS[raidId];
    if (!definition) throw new Error(`Raid not found: ${raidId}`);
    const raid = loadRaid(definition.raid);
    if (!raid.botPatterns) return raid;
    if (definition.bots === undefined) throw new Error(`Bot patterns not found: ${raid.botPatterns}`);
    return applyBotPatterns(raid, loadBotPatterns(definition.bots));
  }
}
