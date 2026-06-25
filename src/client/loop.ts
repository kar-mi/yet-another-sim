import type { Renderer } from "./render/Renderer";
import { getIntent, getRightStick, getKeyboardCameraPan, setOneShotSink } from "./input";
import type { NetClient } from "./net";
import type { Intent } from "@shared/types";
import { recordLoopPerf } from "./perfMetrics";

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
  // One-shot flags the sink already consumed+sent (jump/sprint). The predictor runs only in the rAF
  // frame, whose getIntent sees them as false, so replay them into the next predicted frame —
  // otherwise the predicted local player never jumps/sprints and masks the authoritative jump.
  let pendingJump = false;
  let pendingSprint = false;
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
    if (intent.jump) pendingJump = true;
    if (intent.sprint) pendingSprint = true;
  };

  function frame(now: number): void {
    const frameStart = performance.now();
    const elapsed = Math.min((now - lastTime) / 1000, 0.1);
    const rafMs = now - lastTime;
    lastTime = now;

    const intent = getIntent(renderer.getCameraYaw(), elapsed, renderer.getPanButtons());
    sendIntent(intent);
    renderer.rotateCameraYaw(getKeyboardCameraPan());

    // Replay sink-consumed one-shots into the prediction intent only (already sent, so not re-sent).
    const predictIntent = pendingJump || pendingSprint
      ? { ...intent, jump: intent.jump || pendingJump, sprint: intent.sprint || pendingSprint }
      : intent;
    pendingJump = false;
    pendingSprint = false;

    const rs = getRightStick();
    renderer.applyControllerPan(rs.x, rs.y, elapsed);
    const getViewStart = performance.now();
    const view = net.getRenderView(now, { intent: predictIntent, dt: elapsed });
    const getViewMs = performance.now() - getViewStart;
    let syncMs = 0;
    if (view) {
      const syncStart = performance.now();
      renderer.sync(view);
      syncMs = performance.now() - syncStart;
    }
    const renderStart = performance.now();
    renderer.render();
    const renderMs = performance.now() - renderStart;
    recordLoopPerf({
      rafMs,
      frameMs: performance.now() - frameStart,
      getViewMs,
      syncMs,
      renderMs,
    });
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
