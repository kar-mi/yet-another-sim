import type { Renderer } from "./render/Renderer";
import { getIntent, getRightStick, getKeyboardCameraPan, setOneShotSink } from "./input";
import type { NetClient } from "./net";
import type { Intent } from "@shared/types";

function hasOneShotIntent(intent: Intent): boolean {
  return !!(
    intent.jump
    || intent.sprint
    || intent.antiKnockback
    || intent.provoke
    || intent.cycleTarget
    || intent.toggleInvincibility
  );
}

function sameContinuousIntent(a: Intent, b: Intent): boolean {
  return a.move.x === b.move.x
    && a.move.z === b.move.z
    && a.facing === b.facing;
}

export function startNetLoop(renderer: Renderer, net: NetClient): () => void {
  let lastTime = performance.now();
  let lastSentIntent: Intent | null = null;
  let rafId = 0;
  const resetIntentCache = () => { lastSentIntent = null; };
  const disposeJoined = net.on("joined", resetIntentCache);
  const disposeLobby = net.on("lobby", resetIntentCache);
  const disposeStarted = net.on("started", resetIntentCache);
  const disposePlayback = net.on("playback", message => {
    resetIntentCache();
    renderer.setPlaybackState(message.state);
  });

  function sendIntent(intent: Intent): void {
    if (hasOneShotIntent(intent) || !lastSentIntent || !sameContinuousIntent(intent, lastSentIntent)) {
      if (net.send({ type: "intent", intent })) lastSentIntent = intent;
    }
  }

  const sendIntentNow = () => {
    const intent = getIntent(renderer.getCameraYaw(), 0, renderer.getPanButtons());
    sendIntent(intent);
  };

  function frame(now: number): void {
    const elapsed = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    const intent = getIntent(renderer.getCameraYaw(), elapsed, renderer.getPanButtons());
    sendIntent(intent);
    renderer.rotateCameraYaw(getKeyboardCameraPan());

    const rs = getRightStick();
    renderer.applyControllerPan(rs.x, rs.y, elapsed);
    const view = net.getRenderView(now);
    if (view) renderer.sync(view);
    renderer.render();
    rafId = requestAnimationFrame(frame);
  }

  setOneShotSink(sendIntentNow);
  rafId = requestAnimationFrame(frame);
  return () => {
    setOneShotSink(null);
    cancelAnimationFrame(rafId);
    disposeJoined();
    disposeLobby();
    disposeStarted();
    disposePlayback();
  };
}
