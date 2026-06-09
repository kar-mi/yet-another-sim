import type { Renderer } from "./render/Renderer";
import { getIntent, getRightStick, getKeyboardCameraPan } from "./input";
import type { NetClient } from "./net";

export function startNetLoop(renderer: Renderer, net: NetClient): () => void {
  let lastTime = performance.now();
  let rafId = 0;

  function frame(now: number): void {
    const elapsed = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const intent = getIntent(renderer.getCameraYaw(), elapsed, renderer.getPanButtons());
    net.send({ type: "intent", intent });
    renderer.rotateCameraYaw(getKeyboardCameraPan());

    const rs = getRightStick();
    renderer.applyControllerPan(rs.x, rs.y, elapsed);
    const view = net.getRenderView(now);
    if (view) renderer.sync(view, 0);
    renderer.render();
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(rafId);
}
