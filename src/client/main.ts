import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings, setControllerBindings, setControllerDeadzone, setControlScheme } from "./input";
import { startNetLoop } from "./loop";
import { loadSettings, saveSettings } from "./settings";
import { showLanding, showLobby } from "./ui/MainMenu";
import { initSettingsPanel } from "./ui/SettingsPanel";
import { createRaidHudSelect } from "./ui/RaidHudSelect";
import { connect } from "./net";
import { preloadAssets } from "./render/preloadAssets";
import { SessionIdSchema } from "@shared/protocol";
import { consoleSink, logger, parseLevel } from "@shared/logger";
import { HudLayoutManager } from "./ui/HudLayoutManager";

logger.configure({
  level: parseLevel(
    new URLSearchParams(location.search).get("log"),
    "warn",
  ),
  sinks: [consoleSink],
});

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  preloadAssets();

  const sessionParam = new URLSearchParams(location.search).get("s");
  const parsedSession = sessionParam ? SessionIdSchema.safeParse(sessionParam.toLowerCase()) : null;

  const net = await connect();
  const settings = loadSettings();
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
  let sessionId = parsedSession?.success ? parsedSession.data : await showLanding();

  // Each iteration is one sim session: pick a class in the lobby, play, click Home to come back.
  for (;;) {
    homeBtn.style.display = "none";
    const lobbyResult = await showLobby(net, sessionId);
    if (lobbyResult.kind === "expired") {
      sessionId = await showLanding({ notice: "Session expired" });
      continue;
    }
    const session = lobbyResult;

    let expired = false;
    let resolveSessionEnd!: () => void;
    const sessionEnd = new Promise<void>(resolve => { resolveSessionEnd = resolve; });
    resolveHome = resolveSessionEnd;
    const offExpire = net.on("sessionExpired", () => {
      expired = true;
      resolveSessionEnd();
    });

    renderer = new BabylonRenderer(canvas, nextSettings => {
      Object.assign(settings, nextSettings);
      saveSettings(settings);
    }, position => {
      net.send({ type: "debugPosition", ...position });
    }, enabled => {
      net.send({ type: "setBotsInvincible", enabled });
    }, hudLayout);
    renderer.init(session.world, sessionId, session.yourPlayerId);
    renderer.applySettings(settings);
    renderer.setPlaybackState(session.playbackState);
    syncKeybindLabels();
    updateController();

    const disposeRaidSelect = await createRaidHudSelect(net, session.raidId, session.isHost, session.playbackState, hudLayout);
    const disposeInput = initInput();
    const stopLoop = startNetLoop(renderer, net);

    const activeRenderer = renderer;
    currentTeardown = () => {
      stopLoop();
      disposeInput();
      disposeRaidSelect();
      activeRenderer.dispose();
    };

    homeBtn.style.display = "block";
    await sessionEnd;
    resolveHome = null;
    offExpire();

    homeBtn.style.display = "none";
    currentTeardown();
    currentTeardown = () => {};
    renderer = null;
    if (expired) {
      sessionId = await showLanding({ notice: "Session expired" });
      continue;
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
