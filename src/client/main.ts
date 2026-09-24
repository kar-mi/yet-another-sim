import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings, setControllerBindings, setControllerDeadzone, setControlScheme } from "./input";
import { startNetLoop } from "./loop";
import { loadSettings, saveSettings } from "./settings";
import { showLanding, showLobby } from "./ui/MainMenu";
import { createReplayBrowser, type LoadedReplay } from "./ui/ReplayBrowser";
import { maybeShowWelcomeModal, setSimulatorTourContext } from "./ui/WelcomeModal";
import { initSettingsPanel } from "./ui/SettingsPanel";
import { createRaidHudSelect } from "./ui/RaidHudSelect";
import { createBotActionsModal } from "./ui/BotActionsModal";
import { NetClient, connect } from "./net";
import { participantId } from "./participant";
import { ReplayTransport } from "./replayTransport";
import { replayRepository } from "./replayRepository";
import { collectReplayInsights } from "./replayInsights";
import { createReplayReview } from "./ui/ReplayReview";
import { preloadAssets } from "./render/preloadAssets";
import { SessionIdSchema, type PlaybackState, type ReplayView, type SessionPhase } from "@model/protocol";
import { consoleSink, logger, parseLevel } from "@shared/logger";
import { HudLayoutManager } from "./ui/HudLayoutManager";
import { initPerfHud } from "./perfMetrics";

interface SessionRuntimeOptions {
  renderer: BabylonRenderer;
  net: NetClient;
  playbackState: PlaybackState;
  readOnly?: boolean;
  closeNet?: boolean;
  createRaidSelect: () => Promise<() => void>;
  syncKeybindLabels: () => void;
  updateController: () => void;
}

const PING_INTERVAL_MS = 2000;

async function startSessionRuntime(options: SessionRuntimeOptions, settings: ReturnType<typeof loadSettings>): Promise<() => void> {
  const { renderer, net } = options;
  renderer.applySettings(settings);
  renderer.setPlaybackState(options.playbackState);
  options.syncKeybindLabels();
  options.updateController();

  const disposeRaidSelect = await options.createRaidSelect();
  const disposeInput = initInput();
  const disposePerfHud = initPerfHud();
  const stopLoop = startNetLoop(renderer, net, { readOnly: options.readOnly });
  const pingTimer = setInterval(() => net.ping(ms => renderer.setPing(ms)), PING_INTERVAL_MS);

  return () => {
    clearInterval(pingTimer);
    stopLoop();
    disposePerfHud();
    disposeInput();
    disposeRaidSelect();
    if (options.closeNet) net.close();
    renderer.dispose();
  };
}

logger.configure({
  level: parseLevel(
    new URLSearchParams(location.search).get("log"),
    "warn",
  ),
  sinks: [consoleSink],
});

function hideBootLoading(): void {
  const boot = document.getElementById("yas-boot-loading");
  if (!boot) return;
  boot.classList.add("is-hidden");
  window.setTimeout(() => boot.remove(), 220);
}

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  preloadAssets();

  const sessionParam = new URLSearchParams(location.search).get("s");
  const parsedSession = sessionParam ? SessionIdSchema.safeParse(sessionParam.toLowerCase()) : null;

  const net = await connect();
  const settings = loadSettings();
  const onSettingsChange = (nextSettings: Partial<typeof settings>) => {
    Object.assign(settings, nextSettings);
    saveSettings(settings);
  };
  const hudLayout = new HudLayoutManager(settings.hudLayout, settings.uiScale, layout => {
    settings.hudLayout = layout;
    saveSettings(settings);
  });
  let renderer: BabylonRenderer | null = null;
  const getRenderer = () => renderer;

  setKeyBindings(settings.keyBindings);
  setControllerBindings(settings.controllerBindings);
  setControllerDeadzone(settings.controllerDeadzone);
  setControlScheme(settings.controlScheme);

  const { syncKeybindLabels, updateController } = initSettingsPanel(settings, getRenderer, hudLayout);

  const homeBtn = document.getElementById("home-btn")!;
  const replayBtn = document.getElementById("replay-btn")!;
  const replayExitBtn = document.getElementById("replay-exit-btn")!;
  let resolveHome: (() => void) | null = null;
  homeBtn.addEventListener("click", () => resolveHome?.());

  let currentTeardown = () => {};
  const meta = import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } };
  meta.hot?.dispose(() => {
    currentTeardown();
    net.close();
  });

  let sessionId: string;
  if (parsedSession?.success) {
    sessionId = parsedSession.data;
  } else {
    const landing = showLanding();
    hideBootLoading();
    sessionId = await landing;
  }

  let setupNotice: string | undefined;
  for (;;) {
    homeBtn.style.display = "none";
    const lobby = showLobby(net, sessionId, setupNotice);
    setupNotice = undefined;
    hideBootLoading();
    const lobbyResult = await lobby;
    if (lobbyResult.kind === "expired") {
      sessionId = await showLanding({ notice: "Session expired" });
      continue;
    }
    const session = lobbyResult;

    let expired = false;
    let autoReturned = false;
    let leaving = false;
    let inReplay = false;
    let isHost = session.isHost;
    let phase: SessionPhase = session.phase;
    let playbackState = session.playbackState;
    let pendingReplay: LoadedReplay | null = null;
    let activeReplay: { pull: number; sync: (view: ReplayView) => void } | null = null;
    let replayLoadGeneration = 0;
    let resolveView: (() => void) | null = null;

    const endView = () => {
      const resolve = resolveView;
      resolveView = null;
      resolve?.();
    };
    const leaveSession = () => {
      leaving = true;
      endView();
    };

    const updateToolbar = () => {
      homeBtn.style.display = "block";
      replayBtn.style.display = isHost ? "block" : "none";
      replayExitBtn.style.display = inReplay && isHost ? "block" : "none";
    };

    resolveHome = leaveSession;
    const offExpire = net.on("sessionExpired", () => {
      expired = true;
      leaveSession();
    });
    const offHost = net.on("lobby", message => {
      isHost = net.participantId === message.hostParticipantId;
      phase = message.phase;
      updateToolbar();
    });
    const offPlayback = net.on("playback", message => {
      isHost = net.participantId === message.hostParticipantId;
      phase = message.phase;
      playbackState = message.state;
      updateToolbar();
    });
    const offTransition = net.on("transition", () => {
      autoReturned = true;
      setupNotice = "The raid ended because no participants were left. Everyone is back in the lobby.";
      leaveSession();
    });

    const followReplay = (view: ReplayView | null) => {
      if (isHost) return;
      if (view === null) {
        replayLoadGeneration += 1;
        if (inReplay) endView();
        return;
      }
      if (activeReplay?.pull === view.pull) {
        activeReplay.sync(view);
        return;
      }
      const token = ++replayLoadGeneration;
      replayRepository.load(sessionId, view.pull).then(loaded => {
        if (token !== replayLoadGeneration || leaving) return;
        pendingReplay = { pull: view.pull, raidId: loaded.raidId, world: loaded.world, frames: loaded.frames };
        endView();
      }, error => {
        if (token === replayLoadGeneration) logger.error("net", "failed to load shared replay", { pull: view.pull, err: error });
      });
    };
    const offReplay = net.on("replay", message => followReplay(message.view));

    const replayBrowser = createReplayBrowser(sessionId, replay => {
      pendingReplay = replay;
      net.send({ type: "setReplay", view: { pull: replay.pull, playing: false, tick: 0 } });
      endView();
    });
    const onReplayBtn = () => replayBrowser.open();
    const onReplayExitBtn = () => {
      if (!inReplay) return;
      net.send({ type: "setReplay", view: null });
      endView();
    };
    replayBtn.addEventListener("click", onReplayBtn);
    replayExitBtn.addEventListener("click", onReplayExitBtn);

    let enteredLive = false;
    const startLiveView = async (): Promise<() => void> => {
      const world = (enteredLive ? net.getRenderView(performance.now()) : null) ?? session.world;
      enteredLive = true;
      const botActions = createBotActionsModal(net, {
        isHost,
        botsInvincible: session.botsInvincible,
        botsInvisible: session.botsInvisible,
      });
      const liveRenderer = new BabylonRenderer(canvas, onSettingsChange, position => {
        net.send({ type: "debugPosition", ...position });
      }, botActions.button, hudLayout);
      renderer = liveRenderer;
      liveRenderer.init(world, sessionId, session.yourPlayerId);
      const offBotsInvisible = net.on("lobby", message => liveRenderer.setBotsInvisible(message.botsInvisible));
      const dispose = await startSessionRuntime({
        renderer: liveRenderer,
        net,
        playbackState,
        createRaidSelect: () => createRaidHudSelect(net, hudLayout, {
          raidId: session.raidId,
          selectedRaidId: session.selectedRaidId,
          isHost,
          phase,
          playbackState,
          worldSeed: session.world.seed,
          rngConstraints: session.rngConstraints,
          rngDecisions: session.rngDecisions,
          waymarkPresetId: session.waymarkPresetId,
          botPatternOptions: session.botPatternOptions,
          botPatternId: session.botPatternId,
        }),
        syncKeybindLabels,
        updateController,
      }, settings);
      setSimulatorTourContext({ isHost, hasReplayButton: isHost, hudLayout });
      maybeShowWelcomeModal();
      return () => {
        setSimulatorTourContext(null);
        offBotsInvisible();
        dispose();
        botActions.dispose();
        renderer = null;
      };
    };

    const startReplayView = async (replay: LoadedReplay): Promise<() => void> => {
      const follower = !isHost;
      const transport = new ReplayTransport(replay);
      let seekShareTimer: ReturnType<typeof setTimeout> | null = null;
      const shareView = () => {
        if (seekShareTimer) clearTimeout(seekShareTimer);
        seekShareTimer = null;
        net.send({ type: "setReplay", view: { pull: replay.pull, playing: transport.isPlaying(), tick: transport.currentTick() } });
      };
      const playback = follower
        ? { play: () => {}, pause: () => {}, restart: () => {}, seek: (_tick: number) => {} }
        : {
          play: () => { transport.play(); shareView(); },
          pause: () => { transport.pause(); shareView(); },
          restart: () => { transport.restart(); shareView(); },
          seek: (tick: number) => {
            transport.seek(tick);
            if (!seekShareTimer) seekShareTimer = setTimeout(shareView, 150);
          },
        };
      const replayNet = new NetClient(transport);
      await replayNet.open();
      replayNet.send({ type: "join", sessionId, raidId: replay.raidId, participantId: participantId() });

      const replayRenderer = new BabylonRenderer(canvas, onSettingsChange, () => {}, null, hudLayout);
      renderer = replayRenderer;
      replayRenderer.init(replay.world, sessionId);
      const review = createReplayReview(collectReplayInsights(replay), {
        duration: () => transport.duration(),
        currentTick: () => transport.currentTick(),
        pause: playback.pause,
        seek: playback.seek,
        spectate: playerId => replayRenderer.setSpectateTarget(playerId),
        canSeek: !follower,
      }, hudLayout);
      hudLayout.setGroupSuppressed("hotbar", true);
      const dispose = await startSessionRuntime({
        renderer: replayRenderer,
        net: replayNet,
        playbackState: "paused",
        readOnly: true,
        closeNet: true,
        createRaidSelect: () => createRaidHudSelect(replayNet, hudLayout, {
          raidId: replay.raidId,
          selectedRaidId: replay.raidId,
          isHost: false,
          phase: "raid",
          playbackState: "paused",
        }, {
          duration: () => transport.duration(),
          currentTick: () => transport.currentTick(),
          ...playback,
          readOnly: follower,
        }, review),
        syncKeybindLabels,
        updateController,
      }, settings);
      if (follower) {
        activeReplay = { pull: replay.pull, sync: view => transport.sync(view) };
        if (net.replayView?.pull === replay.pull) transport.sync(net.replayView);
      }
      return () => {
        if (seekShareTimer) clearTimeout(seekShareTimer);
        activeReplay = null;
        review.dispose();
        hudLayout.setGroupSuppressed("hotbar", false);
        dispose();
        renderer = null;
      };
    };

    followReplay(net.replayView);

    for (;;) {
      const viewEnd = new Promise<void>(resolve => { resolveView = resolve; });
      const replay = pendingReplay;
      pendingReplay = null;
      inReplay = replay !== null;
      updateToolbar();
      currentTeardown = replay ? await startReplayView(replay) : await startLiveView();
      await viewEnd;
      currentTeardown();
      currentTeardown = () => {};
      if (leaving) break;
    }

    resolveHome = null;
    replayLoadGeneration += 1;
    offReplay();
    offExpire();
    offHost();
    offPlayback();
    offTransition();
    replayBrowser.dispose();
    replayBtn.removeEventListener("click", onReplayBtn);
    replayExitBtn.removeEventListener("click", onReplayExitBtn);
    replayBtn.style.display = "none";
    replayExitBtn.style.display = "none";
    homeBtn.style.display = "none";

    if (expired) {
      sessionId = await showLanding({ notice: "Session expired" });
      continue;
    }
    if (isHost) {
      net.send({ type: "leave" });
    }
    if (autoReturned) continue;
    if (session.yourPlayerId) {
      net.send({ type: "releaseSlot", playerId: session.yourPlayerId });
    } else {
      net.send({ type: "releaseObserver" });
    }
  }
}

main().catch((err) => {
  logger.error("app", "fatal", { err });
  const pre = document.createElement("pre");
  Object.assign(pre.style, { color: "red", padding: "1em" });
  pre.textContent = String(err);
  document.body.innerHTML = "";
  document.body.appendChild(pre);
});
