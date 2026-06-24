import { applyBotPatterns, loadBotPatterns, loadRaid } from "../engine/raidLoader";
import { createEmptyRaid, SessionManager } from "../server/session";
import { EMPTY_RAID_ID, type ClientMessage, type ServerMessage } from "@shared/protocol";
import type { Transport } from "./net";
import { RAID_DEFS } from "./staticRaids.generated";

export class LoopbackTransport implements Transport {
  private readonly clientId = crypto.randomUUID();
  private messageHandler: (message: ServerMessage) => void = () => {};
  private readonly manager = new SessionManager({
    raidsDir: "",
    now: () => Date.now(),
    maxSessions: Infinity,
    send: (clientId, message) => {
      if (clientId !== this.clientId) return;
      const normalized = JSON.parse(
        typeof message === "string" ? message : JSON.stringify(message),
      ) as ServerMessage;
      this.messageHandler(normalized);
    },
    loadRaid: async raidId => {
      if (raidId === EMPTY_RAID_ID) return createEmptyRaid();
      const definition = RAID_DEFS[raidId];
      if (!definition) throw new Error(`Raid not found: ${raidId}`);
      const raid = loadRaid(definition.raid);
      if (!raid.botPatterns) return raid;
      if (definition.bots === undefined) throw new Error(`Bot patterns not found: ${raid.botPatterns}`);
      return applyBotPatterns(raid, loadBotPatterns(definition.bots));
    },
  });

  open(): Promise<void> {
    this.messageHandler({ type: "joined", clientId: this.clientId });
    return Promise.resolve();
  }

  send(message: ClientMessage): boolean {
    void this.manager.handle(this.clientId, message);
    return true;
  }

  onMessage(cb: (message: ServerMessage) => void): void {
    this.messageHandler = cb;
  }

  onReconnect(_cb: () => void): void {}

  close(): void {
    this.manager.disconnect(this.clientId);
  }
}
