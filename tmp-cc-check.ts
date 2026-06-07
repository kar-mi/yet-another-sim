import { readFileSync } from "fs";
import { loadRaid } from "./src/engine/raidLoader";
import { createWorld } from "./src/engine/world";
import { tick } from "./src/engine/sim";

const raw = JSON.parse(readFileSync("raids/debug/cc-test.json", "utf8"));
const raid = loadRaid(raw);
console.log("loaded OK:", raid.name, "events:", raid.events.length);

let w = createWorld(raid, 42);
const seenFired = new Set<string>();
const seenTp = new Set<string>();
for (let i = 0; i < 45 * 60; i++) {
  w = tick(w, {}, 1 / 60); // bots only; m1 idle
  for (const fm of w.forcedMarches) {
    if (fm.triggered && !seenFired.has(fm.id)) {
      seenFired.add(fm.id);
      console.log(`t=${w.time.toFixed(2)} ${fm.name} captured ${fm.capturedPlayerId}`);
    }
    if (fm.teleported && !seenTp.has(fm.id)) {
      seenTp.add(fm.id);
      console.log(`t=${w.time.toFixed(2)} ${fm.name} teleported ${fm.capturedPlayerId}`);
    }
  }
}
const hits = w.log.filter(l => l.event === "hit");
console.log("traps captured:", seenFired.size, "teleported:", seenTp.size);
console.log("hit log:", hits.map(h => `${h.mechanic}->${h.playerId}@${h.t.toFixed(1)}`).join(", "));
console.log("final HP:", w.players.map(p => `${p.id}:${Math.round(p.hp)}`).join(" "));
