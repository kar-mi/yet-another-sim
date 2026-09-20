import { EMPTY_RAID_ID, type BotPatternOption, type DecisionDescription, type PlaybackState, type SessionPhase } from "@shared/protocol";
import { RAID_CHANGE_START_DELAY_MS } from "@shared/constants";
import type { NetClient } from "../net";
import { el } from "./dom";
import { loadRaidCategories } from "./MainMenu";
import { createRaidPicker } from "./RaidPicker";
import { showLoadingOverlay } from "./LoadingOverlay";
import type { HudLayoutManager } from "./HudLayoutManager";
import { armRngConstraints, armWaymark, createOptionsModal } from "./OptionsModal";
import { loadRngConstraints } from "../rngPrefs";
import { loadWaymarkPreset } from "../waymarkPrefs";
import type { ReplayReview } from "./ReplayReview";
import { ticksToLabel } from "../replayReviewModel";

export interface RaidHudSession {
  raidId: string;
  selectedRaidId: string;
  isHost: boolean;
  phase: SessionPhase;
  playbackState: PlaybackState;
  worldSeed?: number | null;
  rngConstraints?: Record<string, number>;
  rngDecisions?: DecisionDescription[];
  waymarkPresetId?: string | null;
  botPatternOptions?: BotPatternOption[];
  botPatternId?: string | null;
}

function parseLabel(label: string): number | null {
  const trimmed = label.trim();
  const match = /^(?:(\d+):)?(\d{1,2})$/.exec(trimmed);
  if (!match) return null;
  const mins = match[1] ? Number(match[1]) : 0;
  const secs = Number(match[2]);
  if (secs >= 60) return null;
  return Math.round((mins * 60 + secs) * 60);
}

/**
 * In-sim HUD: the raid picker, the options modal, and playback controls.
 * Returns a disposer that tears down listeners and DOM.
 */
export async function createRaidHudSelect(
  net: NetClient,
  hudLayout: HudLayoutManager,
  session: RaidHudSession,
  replay?: { duration: () => number; currentTick: () => number; play: () => void; pause: () => void; restart: () => void; seek: (tick: number) => void; readOnly?: boolean },
  replayReview?: ReplayReview,
): Promise<() => void> {
  let isHost = session.isHost;
  let phase = session.phase;
  let lastState = session.playbackState;
  let activeRaidId = session.raidId;
  let selectedRaidId = session.selectedRaidId;

  const wrapper = el("div", { id: "yas-raid-select" });
  const label = el("span", { className: "yas-session-label", textContent: "RAID" });

  const picker = replay ? null : createRaidPicker({
    categories: await loadRaidCategories().catch(() => []),
    initialRaidId: selectedRaidId,
    enabled: isHost,
    onSelect: raidId => net.send({ type: "setRaid", raidId }),
  });
  const optionsModal = replay ? null : createOptionsModal(net, {
    raidId: selectedRaidId,
    currentSeed: session.worldSeed ?? null,
    rngConstraints: session.rngConstraints ?? {},
    rngDecisions: session.rngDecisions ?? [],
    waymarkPresetId: session.waymarkPresetId ?? null,
    botPatternOptions: session.botPatternOptions ?? [],
    botPatternId: session.botPatternId ?? null,
    isHost,
  });

  const controls = el("div", { className: "yas-playback-controls" });
  const canControl = () => replay ? !replay.readOnly : isHost;
  const makePlaybackBtn = (labelText: string, onClick: () => void) => {
    const btn = el("button", { type: "button", textContent: labelText, disabled: !canControl() });
    btn.addEventListener("click", () => {
      btn.blur();
      onClick();
    });
    return btn;
  };
  // In the waiting lobby this button starts the selected raid; everywhere else it resumes the pull.
  const playBtn = makePlaybackBtn("PLAY", () => {
    if (replay) replay.play();
    else if (phase === "workshop") net.send({ type: "start" });
    else net.send({ type: "play" });
  });
  const pauseBtn = makePlaybackBtn("PAUSE", () => replay ? replay.pause() : net.send({ type: "pause" }));
  const stopBtn = makePlaybackBtn("STOP", () => net.send({ type: "stop" }));
  const restartBtn = makePlaybackBtn("RESTART", () => replay ? replay.restart() : net.send({ type: "restart" }));
  const optionsBtn = replay ? null : makePlaybackBtn("OPTIONS", () => {
    // A live pull is stopped first: options must not change out from under it, and stopping lets the
    // server apply waymark/bot-pattern changes to the frozen world immediately. The waiting lobby has
    // no pull to protect, so it keeps running.
    if (phase === "raid" && lastState !== "stopped") net.send({ type: "stop" });
    optionsModal?.open();
  });
  if (replay) {
    controls.append(playBtn, pauseBtn, restartBtn);
  } else {
    controls.append(playBtn, pauseBtn, stopBtn, restartBtn);
  }

  let draggingSeek = false;
  const seek = replay ? el("input", {
    className: "yas-replay-seek",
    type: "range",
    min: "0",
    max: String(replay.duration()),
    value: "0",
    step: "1",
    ariaLabel: "Replay seek",
    disabled: !!replay.readOnly,
  }) : null;
  seek?.addEventListener("input", () => {
    draggingSeek = true;
    replay?.seek(Number(seek.value));
  });
  seek?.addEventListener("change", () => { draggingSeek = false; });

  let editingTime = false;
  const timeInput = replay ? el("input", {
    className: "yas-replay-time",
    type: "text",
    value: "00:00",
    ariaLabel: "Replay timestamp",
    disabled: !!replay.readOnly,
  }) : null;
  const durationLabel = replay ? el("span", {
    className: "yas-replay-duration",
    textContent: `/ ${ticksToLabel(replay.duration())}`,
  }) : null;
  timeInput?.addEventListener("focus", () => { editingTime = true; });
  timeInput?.addEventListener("blur", () => { editingTime = false; });
  timeInput?.addEventListener("change", () => {
    const t = parseLabel(timeInput.value);
    if (replay && t !== null) replay.seek(Math.min(replay.duration(), Math.max(0, t)));
    if (replay) timeInput.value = ticksToLabel(replay.currentTick());
  });

  const seekTimer = replay && seek ? setInterval(() => {
    seek.max = String(replay.duration());
    if (!draggingSeek) seek.value = String(replay.currentTick());
    if (timeInput && !editingTime) timeInput.value = ticksToLabel(replay.currentTick());
    if (durationLabel) durationLabel.textContent = `/ ${ticksToLabel(replay.duration())}`;
    replayReview?.setPosition(replay.currentTick());
  }, 100) : null;

  const syncPlayback = (state: PlaybackState) => {
    lastState = state;
    const waiting = !replay && phase === "workshop";
    playBtn.textContent = waiting || (!replay && state === "stopped") ? "START" : "PLAY";
    // Picking a raid starts it, so in the waiting lobby this button only re-runs the raid already
    // selected — and there is nothing to run until one is.
    playBtn.disabled = !canControl()
      || (waiting ? selectedRaidId === EMPTY_RAID_ID : state === "playing" || state === "done");
    pauseBtn.disabled = !canControl() || state !== "playing";
    stopBtn.disabled = !canControl() || state === "stopped";
    restartBtn.disabled = !canControl() || waiting;
    // Swapping the raid mid-pull is the one thing the server refuses, so lock the picker there.
    picker?.setEnabled(isHost && !(phase === "raid" && state === "playing"));
    if (optionsBtn) optionsBtn.disabled = !isHost;
    optionsModal?.update({ isHost });
  };

  // A raid swap replaces every client's world; cover the rebuild so it doesn't read as a freeze.
  const onRaidId = (raidId: string) => {
    if (raidId === activeRaidId) return;
    activeRaidId = raidId;
    showLoadingOverlay(RAID_CHANGE_START_DELAY_MS);
  };
  const disposePlayback = net.on("playback", message => {
    isHost = replay ? false : net.participantId === message.hostParticipantId;
    phase = message.phase;
    onRaidId(message.raidId);
    optionsModal?.update({ rngDecisions: message.rngDecisions });
    syncPlayback(message.state);
  });
  const disposeLobby = net.on("lobby", message => {
    isHost = replay ? false : net.participantId === message.hostParticipantId;
    phase = message.phase;
    selectedRaidId = message.selectedRaidId;
    onRaidId(message.raidId);
    picker?.setRaidId(message.selectedRaidId);
    optionsModal?.update({
      raidId: message.selectedRaidId,
      rngConstraints: message.rngConstraints,
      rngDecisions: message.rngDecisions,
      waymarkPresetId: message.waymarkPresetId,
      botPatternOptions: message.botPatternOptions,
      botPatternId: message.botPatternId,
      isHost,
    });
    // Re-apply this browser's saved per-raid preferences after the server cleared them on a swap.
    if (isHost && JSON.stringify(message.rngConstraints) !== JSON.stringify(loadRngConstraints(message.selectedRaidId))) {
      armRngConstraints(net, message.selectedRaidId);
    }
    if (isHost && message.waymarkPresetId === null && loadWaymarkPreset(message.selectedRaidId) !== null) {
      armWaymark(net, message.selectedRaidId);
    }
    syncPlayback(message.playbackState);
  });
  const disposeStarted = net.on("started", message => {
    optionsModal?.update({ currentSeed: message.world.seed });
    if (isHost) armWaymark(net, selectedRaidId);
  });
  syncPlayback(session.playbackState);

  // A replay has nothing to select, so the selector is not built at all and its playback controls
  // live in the seek window instead.
  if (!replay && picker) {
    const selectRow = el("div", { className: "yas-raid-select-row" }, [picker.button]);
    if (optionsBtn) selectRow.appendChild(el("div", { className: "yas-rng-controls" }, [optionsBtn]));
    wrapper.append(label, selectRow, controls);
    document.body.appendChild(wrapper);
    hudLayout.register("raidselector", wrapper);
  }

  let seekWrapper: HTMLElement | null = null;
  if (seek && timeInput && durationLabel) {
    const timeRow = el("div", { className: "yas-replay-time-row" });
    timeRow.append(timeInput, durationLabel);
    const dragHandle = el("div", {
      className: "yas-hud-drag-handle",
      title: "Drag to move",
      attrs: { "aria-hidden": "true" },
    });
    seekWrapper = el("div", { id: "yas-replay-seekbar" }, [
      dragHandle,
      el("span", { className: "yas-session-label", textContent: "PLAYBACK" }),
      controls,
      seek,
    ]);
    seekWrapper.appendChild(timeRow);
    if (replayReview?.sections) seekWrapper.appendChild(replayReview.sections);
    document.body.appendChild(seekWrapper);
    hudLayout.register("replayseek", seekWrapper, { dragHandle });
  }

  return () => {
    disposePlayback();
    disposeLobby();
    disposeStarted();
    picker?.dispose();
    optionsModal?.dispose();
    if (seekTimer) clearInterval(seekTimer);
    if (!replay) {
      hudLayout.unregister("raidselector");
      wrapper.remove();
    }
    if (seekWrapper) {
      hudLayout.unregister("replayseek");
      seekWrapper.remove();
    }
  };
}
