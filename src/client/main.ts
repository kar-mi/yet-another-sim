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
import { ReplayTransport } from "./replayTransport";
import { collectReplayInsights } from "./replayInsights";
import { createReplayReview } from "./ui/ReplayReview";
import { preloadAssets } from "./render/preloadAssets";
import { SessionIdSchema, type PlaybackState } from "@shared/protocol";
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

  return () => {
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

  // Home button: resolve the per-session promise to leave the sim and return to the lobby.
  const homeBtn = document.getElementById("home-btn")!;
  const replayBtn = document.getElementById("replay-btn")!;
  const replayExitBtn = document.getElementById("replay-exit-btn")!;
  let resolveHome: (() => void) | null = null;
  homeBtn.addEventListener("click", () => resolveHome?.());

  // HMR cleanup (Bun --hot) — tear down whatever session is currently active.
  let currentTeardown = () => {};
  const meta = import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } };
  meta.hot?.dispose(() => {
    currentTeardown();
    net.close();
  });

  // Resolve the session id only after the settings handlers are wired, so the ⚙ panel
  // also works on the landing page (base URL with no ?s= param).
  let sessionId: string;
  if (parsedSession?.success) {
    sessionId = parsedSession.data;
  } else {
    const landing = showLanding();
    hideBootLoading();
    sessionId = await landing;
  }

  // Each iteration is one sim session: pick a class in the lobby, play, click Home to come back.
  for (;;) {
    homeBtn.style.display = "none";
    const lobby = showLobby(net, sessionId);
    hideBootLoading();
    const lobbyResult = await lobby;
    if (lobbyResult.kind === "expired") {
      sessionId = await showLanding({ notice: "Session expired" });
      continue;
    }
    const session = lobbyResult;

    let expired = false;
    let leaving = false;
    let inReplay = false;
    let isHost = session.isHost;
    let raidId = session.raidId;
    let playbackState = session.playbackState;
    // Set when the host picks a recording; the view loop then swaps the live sim for playback.
    let pendingReplay: LoadedReplay | null = null;
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

    // Replay browsing belongs to the current host; the exit button only exists during playback.
    const updateToolbar = () => {
      homeBtn.style.display = "block";
      replayBtn.style.display = isHost ? "block" : "none";
      replayExitBtn.style.display = inReplay ? "block" : "none";
    };

    resolveHome = leaveSession;
    const offExpire = net.on("sessionExpired", () => {
      expired = true;
      leaveSession();
    });
    const offHost = net.on("lobby", message => {
      isHost = net.clientId === message.hostClientId;
      raidId = message.raidId;
      updateToolbar();
    });
    const offPlayback = net.on("playback", message => {
      isHost = net.clientId === message.hostClientId;
      raidId = message.raidId;
      playbackState = message.state;
      updateToolbar();
    });

    const replayBrowser = createReplayBrowser(sessionId, replay => {
      pendingReplay = replay;
      endView();
    });
    const onReplayBtn = () => replayBrowser.open();
    const onReplayExitBtn = () => { if (inReplay) endView(); };
    replayBtn.addEventListener("click", onReplayBtn);
    replayExitBtn.addEventListener("click", onReplayExitBtn);

    let enteredLive = false;
    const startLiveView = async (): Promise<() => void> => {
      // On re-entry the pull may have moved on while a replay was on screen, so seed the renderer
      // from whatever the replica has buffered; the first entry uses the world `started` delivered.
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
        createRaidSelect: () => createRaidHudSelect(net, raidId, isHost, playbackState, hudLayout, session.world.seed, session.rngConstraints, undefined, session.rngDecisions, session.waymarkPresetId, session.botPatternOptions, session.botPatternId),
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
      const transport = new ReplayTransport(replay);
      const replayNet = new NetClient(transport);
      await replayNet.open();
      replayNet.send({ type: "join", sessionId, raidId: replay.raidId });

      const replayRenderer = new BabylonRenderer(canvas, onSettingsChange, () => {}, null, hudLayout);
      renderer = replayRenderer;
      replayRenderer.init(replay.world, sessionId);
      const review = createReplayReview(collectReplayInsights(replay), {
        duration: () => transport.duration(),
        currentTick: () => transport.currentTick(),
        pause: () => transport.pause(),
        seek: tick => transport.seek(tick),
        spectate: playerId => replayRenderer.setSpectateTarget(playerId),
      }, hudLayout);
      hudLayout.setGroupSuppressed("hotbar", true);
      const dispose = await startSessionRuntime({
        renderer: replayRenderer,
        net: replayNet,
        playbackState: "paused",
        readOnly: true,
        closeNet: true,
        createRaidSelect: () => createRaidHudSelect(replayNet, replay.raidId, false, "paused", hudLayout, replay.world.seed, {}, transport, [], null, [], null, review),
        syncKeybindLabels,
        updateController,
      }, settings);
      return () => {
        review.dispose();
        hudLayout.setGroupSuppressed("hotbar", false);
        dispose();
        renderer = null;
      };
    };

    // One iteration per view: the live sim, or a recording the host chose to watch.
    for (;;) {
      const viewEnd = new Promise<void>(resolve => { resolveView = resolve; });
      const replay = pendingReplay;
      pendingReplay = null;
      inReplay = replay !== null;
      // Show the toolbar first: the guided tour spotlights the ▶ button as soon as the live view is up.
      updateToolbar();
      currentTeardown = replay ? await startReplayView(replay) : await startLiveView();
      await viewEnd;
      currentTeardown();
      currentTeardown = () => {};
      if (leaving) break;
    }

    resolveHome = null;
    offExpire();
    offHost();
    offPlayback();
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
    // Host leaving via Home stops the pull so the session is joinable again
    // (claimSlot/claimObserver reject while running/paused). Uses `leave` rather than `stop` so the
    // stop's "started" broadcast doesn't bounce the host straight back into the sim.
    if (session.isHost) {
      net.send({ type: "leave" });
    }
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
