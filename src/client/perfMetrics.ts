declare const __YAS_DEBUG__: boolean | undefined;

export const PERF_ENABLED = typeof __YAS_DEBUG__ !== "undefined" && __YAS_DEBUG__;

type ClientPerf = {
  rafMs: number;
  rafMaxMs: number;
  droppedFrames: number;
  frameMs: number;
  frameMaxMs: number;
  getViewMs: number;
  getViewMaxMs: number;
  syncMs: number;
  syncMaxMs: number;
  renderMs: number;
  renderMaxMs: number;
  batchFrames: number;
  batchMaxFrames: number;
  applyFramesMs: number;
  applyFramesMaxMs: number;
  appliedTicks: number;
  appliedTicksMax: number;
  snapshotBuffer: number;
  renderDelayMs: number;
  headroomMs: number;
  extrapolations: number;
  bufferResets: number;
  resyncRequests: number;
  hostSnapshotMs: number;
  hostSnapshotMaxMs: number;
  hostSnapshotBytes: number;
  hostSnapshotMaxBytes: number;
};

const perf: ClientPerf = {
  rafMs: 0,
  rafMaxMs: 0,
  droppedFrames: 0,
  frameMs: 0,
  frameMaxMs: 0,
  getViewMs: 0,
  getViewMaxMs: 0,
  syncMs: 0,
  syncMaxMs: 0,
  renderMs: 0,
  renderMaxMs: 0,
  batchFrames: 0,
  batchMaxFrames: 0,
  applyFramesMs: 0,
  applyFramesMaxMs: 0,
  appliedTicks: 0,
  appliedTicksMax: 0,
  snapshotBuffer: 0,
  renderDelayMs: 0,
  headroomMs: 0,
  extrapolations: 0,
  bufferResets: 0,
  resyncRequests: 0,
  hostSnapshotMs: 0,
  hostSnapshotMaxMs: 0,
  hostSnapshotBytes: 0,
  hostSnapshotMaxBytes: 0,
};

function maxKey<T extends keyof ClientPerf>(key: T, value: number): void {
  if (value > perf[key]) perf[key] = value as ClientPerf[T];
}

export function recordLoopPerf(sample: {
  rafMs: number;
  frameMs: number;
  getViewMs: number;
  syncMs: number;
  renderMs: number;
}): void {
  if (!PERF_ENABLED) return;
  perf.rafMs = sample.rafMs;
  perf.frameMs = sample.frameMs;
  perf.getViewMs = sample.getViewMs;
  perf.syncMs = sample.syncMs;
  perf.renderMs = sample.renderMs;
  maxKey("rafMaxMs", sample.rafMs);
  maxKey("frameMaxMs", sample.frameMs);
  maxKey("getViewMaxMs", sample.getViewMs);
  maxKey("syncMaxMs", sample.syncMs);
  maxKey("renderMaxMs", sample.renderMs);
  if (sample.rafMs > 25) perf.droppedFrames++;
}

export function recordApplyFrames(batchFrames: number, appliedTicks: number, durationMs: number): void {
  if (!PERF_ENABLED) return;
  perf.batchFrames = batchFrames;
  perf.appliedTicks = appliedTicks;
  perf.applyFramesMs = durationMs;
  maxKey("batchMaxFrames", batchFrames);
  maxKey("appliedTicksMax", appliedTicks);
  maxKey("applyFramesMaxMs", durationMs);
}

export function recordInterpolation(sample: {
  snapshotBuffer: number;
  renderDelayMs: number;
  headroomMs: number;
  extrapolated: boolean;
}): void {
  if (!PERF_ENABLED) return;
  perf.snapshotBuffer = sample.snapshotBuffer;
  perf.renderDelayMs = sample.renderDelayMs;
  perf.headroomMs = sample.headroomMs;
  if (sample.extrapolated) perf.extrapolations++;
}

export function recordBufferReset(): void {
  if (PERF_ENABLED) perf.bufferResets++;
}

export function recordResyncRequest(): void {
  if (PERF_ENABLED) perf.resyncRequests++;
}

export function recordHostSnapshot(durationMs: number, bytes: number): void {
  if (!PERF_ENABLED) return;
  perf.hostSnapshotMs = durationMs;
  perf.hostSnapshotBytes = bytes;
  maxKey("hostSnapshotMaxMs", durationMs);
  maxKey("hostSnapshotMaxBytes", bytes);
}

export function initPerfHud(): () => void {
  if (!PERF_ENABLED) return () => {};

  const el = document.createElement("pre");
  el.id = "yas-perf";
  document.body.appendChild(el);

  const timer = setInterval(() => {
    el.textContent = [
      `frame ${perf.frameMs.toFixed(1)}ms max ${perf.frameMaxMs.toFixed(1)} | raf ${perf.rafMs.toFixed(1)} max ${perf.rafMaxMs.toFixed(1)} drop ${perf.droppedFrames}`,
      `view ${perf.getViewMs.toFixed(2)}ms | sync ${perf.syncMs.toFixed(2)} max ${perf.syncMaxMs.toFixed(2)} | render ${perf.renderMs.toFixed(2)} max ${perf.renderMaxMs.toFixed(2)}`,
      `apply ${perf.applyFramesMs.toFixed(2)}ms max ${perf.applyFramesMaxMs.toFixed(2)} | batch ${perf.batchFrames}/${perf.batchMaxFrames} | ticks ${perf.appliedTicks}/${perf.appliedTicksMax}`,
      `interp buf ${perf.snapshotBuffer} | delay ${perf.renderDelayMs.toFixed(1)}ms | headroom ${perf.headroomMs.toFixed(1)}ms | extrap ${perf.extrapolations}`,
      `resync ${perf.resyncRequests} | resets ${perf.bufferResets} | host snap ${perf.hostSnapshotMs.toFixed(2)}ms max ${perf.hostSnapshotMaxMs.toFixed(2)} bytes ${perf.hostSnapshotBytes}/${perf.hostSnapshotMaxBytes}`,
    ].join("\n");
  }, 250);

  return () => {
    clearInterval(timer);
    el.remove();
  };
}
