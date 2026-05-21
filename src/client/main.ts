import { loadRaid } from "../engine/raidLoader";
import { createWorld } from "../engine/world";
import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput } from "./input";
import { startLoop } from "./loop";

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  const res = await fetch("/raids/sample-raid.json");
  if (!res.ok) throw new Error(`Failed to load raid: ${res.status}`);
  const json: unknown = await res.json();

  const raid = loadRaid(json);
  const world = createWorld(raid);

  const renderer = new BabylonRenderer(canvas);
  renderer.init(world);

  const disposeInput = initInput();
  const stopLoop = startLoop(world, renderer, world.players[0].id);

  // HMR cleanup (Bun --hot)
  const meta = import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } };
  meta.hot?.dispose(() => {
    stopLoop();
    disposeInput();
    renderer.dispose();
  });
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  Object.assign(pre.style, { color: "red", padding: "1em" });
  pre.textContent = String(err);
  document.body.innerHTML = "";
  document.body.appendChild(pre);
});
