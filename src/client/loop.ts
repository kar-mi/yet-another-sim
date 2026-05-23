import type { World, Intents } from "../shared/types";
import { tick } from "../engine/sim";
import type { Renderer } from "./render/Renderer";
import { getIntent } from "./input";

const DT = 1 / 60;

export function startLoop(world: World, renderer: Renderer, playerId: string): () => void {
  let current = world;
  let accumulator = 0;
  let lastTime = performance.now();
  let rafId = 0;

  function frame(now: number): void {
    const elapsed = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    accumulator += elapsed;

    const cameraYaw = renderer.getCameraYaw();
    while (accumulator >= DT) {
      if (current.status === "running") {
        const intent = getIntent(cameraYaw);
        const intents: Intents = { [playerId]: intent };
        current = tick(current, intents, DT);
      }
      accumulator -= DT;
    }

    renderer.sync(current, accumulator / DT);
    renderer.render();
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}
