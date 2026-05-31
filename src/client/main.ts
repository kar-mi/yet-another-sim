import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings, setControllerDeadzone, getControllerInfo, listControllers, setActiveGamepad } from "./input";
import { startNetLoop } from "./loop";
import { DEFAULT_BINDINGS, keyLabel, loadSettings, saveSettings } from "./settings";
import type { KeyBindings } from "./settings";
import { loadRaidOptions, showLanding, showLobby } from "./MainMenu";
import { connect, type NetClient } from "./net";
import { EMPTY_RAID_ID, SessionIdSchema, type PlaybackState } from "../shared/protocol";

async function createRaidHudSelect(net: NetClient, initialRaidId: string, initialIsHost: boolean): Promise<() => void> {
  let isHost = initialIsHost;
  let lastState: PlaybackState = "playing";
  const raids = [{ id: EMPTY_RAID_ID, name: "(empty)" }, ...await loadRaidOptions()];
  const wrapper = document.createElement("div");
  wrapper.id = "yas-raid-select";

  const label = document.createElement("span");
  label.className = "yas-session-label";
  label.textContent = "RAID";

  const select = document.createElement("select");
  select.ariaLabel = "Raid plan";
  select.disabled = !isHost;
  for (const raid of raids) {
    const option = document.createElement("option");
    option.value = raid.id;
    option.textContent = raid.name;
    select.appendChild(option);
  }
  select.value = initialRaidId;
  select.addEventListener("change", () => {
    const raidId = select.value;
    select.blur();
    select.disabled = true;
    net.send({ type: "setRaid", raidId });
  });

  const controls = document.createElement("div");
  controls.className = "yas-playback-controls";
  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.textContent = "PLAY";
  const pauseBtn = document.createElement("button");
  pauseBtn.type = "button";
  pauseBtn.textContent = "PAUSE";
  const stopBtn = document.createElement("button");
  stopBtn.type = "button";
  stopBtn.textContent = "STOP";
  const restartBtn = document.createElement("button");
  restartBtn.type = "button";
  restartBtn.textContent = "RESTART";
  playBtn.disabled = !isHost;
  pauseBtn.disabled = !isHost;
  stopBtn.disabled = !isHost;
  restartBtn.disabled = !isHost;
  playBtn.addEventListener("click", () => {
    playBtn.blur();
    net.send({ type: "play" });
  });
  pauseBtn.addEventListener("click", () => {
    pauseBtn.blur();
    net.send({ type: "pause" });
  });
  stopBtn.addEventListener("click", () => {
    stopBtn.blur();
    net.send({ type: "stop" });
  });
  restartBtn.addEventListener("click", () => {
    restartBtn.blur();
    net.send({ type: "restart" });
  });
  controls.append(playBtn, pauseBtn, stopBtn, restartBtn);

  const syncPlayback = (state: PlaybackState) => {
    lastState = state;
    select.disabled = !isHost || state === "playing";
    playBtn.disabled = !isHost || state === "playing";
    pauseBtn.disabled = !isHost || state !== "playing";
    stopBtn.disabled = !isHost || state === "stopped";
    restartBtn.disabled = !isHost;
  };

  const disposePlayback = net.on("playback", message => {
    isHost = net.clientId === message.hostClientId;
    select.value = message.raidId;
    syncPlayback(message.state);
  });
  const disposeError = net.on("error", () => syncPlayback(lastState));
  syncPlayback("playing");

  wrapper.append(label, select, controls);
  document.body.appendChild(wrapper);
  return () => {
    disposePlayback();
    disposeError();
    wrapper.remove();
  };
}

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  const sessionParam = new URLSearchParams(location.search).get("s");
  const parsedSession = sessionParam ? SessionIdSchema.safeParse(sessionParam.toLowerCase()) : null;
  const sessionId = parsedSession?.success ? parsedSession.data : await showLanding();

  const net = await connect();
  const settings = loadSettings();
  let renderer: BabylonRenderer | null = null;

  setKeyBindings(settings.keyBindings);
  setControllerDeadzone(settings.controllerDeadzone);

  const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
  const sensitivityVal = document.getElementById("sensitivity-val")!;
  const panBtns = document.querySelectorAll<HTMLInputElement>('input[name="panBtn"]');
  const settingsPanel = document.getElementById("settings-panel")!;

  sensitivitySlider.value = String(settings.mouseSensitivity);
  sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
  panBtns.forEach(btn => { btn.checked = btn.value === settings.panButton; });

  const syncKeybindLabels = () => {
    document.querySelectorAll<HTMLButtonElement>(".keybind-btn").forEach(btn => {
      const action = btn.dataset.action as keyof KeyBindings;
      btn.textContent = keyLabel(settings.keyBindings[action]);
    });
  };
  syncKeybindLabels();

  document.getElementById("settings-btn")!.addEventListener("click", () => {
    settingsPanel.style.display = "block";
  });
  document.getElementById("settings-close")!.addEventListener("click", () => {
    settingsPanel.style.display = "none";
  });

  sensitivitySlider.addEventListener("input", () => {
    settings.mouseSensitivity = parseFloat(sensitivitySlider.value);
    sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
    saveSettings(settings);
    renderer?.applySettings(settings);
  });

  panBtns.forEach(btn => {
    btn.addEventListener("change", () => {
      if (btn.checked) {
        settings.panButton = btn.value as "left" | "right";
        saveSettings(settings);
        renderer?.applySettings(settings);
      }
    });
  });

  document.getElementById("reset-keybinds")!.addEventListener("click", () => {
    settings.keyBindings = { ...DEFAULT_BINDINGS };
    syncKeybindLabels();
    saveSettings(settings);
    setKeyBindings(settings.keyBindings);
    renderer?.applySettings(settings);
  });

  // Tab switching
  document.querySelectorAll<HTMLButtonElement>(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab!;
      (document.getElementById("tab-camera") as HTMLElement).style.display = target === "camera" ? "" : "none";
      (document.getElementById("tab-controls") as HTMLElement).style.display = target === "controls" ? "" : "none";
      (document.getElementById("tab-controller") as HTMLElement).style.display = target === "controller" ? "" : "none";
    });
  });

  // Controller detection
  const controllerBadge = document.getElementById("controller-type-badge")!;
  const controllerName = document.getElementById("controller-name")!;
  const controllerSelect = document.getElementById("controller-select") as HTMLSelectElement;

  function updateController(): void {
    const list = listControllers();
    controllerSelect.replaceChildren();
    for (const c of list) {
      const opt = document.createElement("option");
      opt.value = String(c.index);
      opt.textContent = `${c.type.toUpperCase()} — ${c.name}`;
      controllerSelect.appendChild(opt);
    }
    controllerSelect.style.display = list.length > 1 ? "" : "none";

    const info = getControllerInfo();
    if (info) {
      controllerSelect.value = String(info.index);
      controllerBadge.textContent = info.type.toUpperCase();
      controllerBadge.className = `controller-badge controller-badge--${info.type}`;
      controllerName.textContent = info.name;
      renderer?.setControllerType(info.type);
    } else {
      controllerBadge.textContent = "NO CONTROLLER";
      controllerBadge.className = "controller-badge controller-badge--none";
      controllerName.textContent = "";
    }
  }

  controllerSelect.addEventListener("change", () => {
    setActiveGamepad(Number(controllerSelect.value));
    updateController();
  });
  window.addEventListener("gamepadconnected", updateController);
  window.addEventListener("gamepaddisconnected", updateController);
  updateController();

  // Keybind rebinding
  document.querySelectorAll<HTMLButtonElement>(".keybind-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.classList.contains("keybind-listening")) return;
      btn.classList.add("keybind-listening");
      const prev = btn.textContent!;
      btn.textContent = "...";

      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.code === "Escape") {
          btn.textContent = prev;
        } else {
          const action = btn.dataset.action as keyof KeyBindings;
          settings.keyBindings[action] = e.code;
          btn.textContent = keyLabel(e.code);
          saveSettings(settings);
          setKeyBindings(settings.keyBindings);
          renderer?.applySettings(settings);
        }
        btn.classList.remove("keybind-listening");
        window.removeEventListener("keydown", onKey, true);
      };
      window.addEventListener("keydown", onKey, true);
    });
  });

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

  // Each iteration is one sim session: pick a class in the lobby, play, click Home to come back.
  for (;;) {
    homeBtn.style.display = "none";
    const session = await showLobby(net, sessionId);

    renderer = new BabylonRenderer(canvas, nextSettings => {
      Object.assign(settings, nextSettings);
      saveSettings(settings);
    });
    renderer.init(session.world, sessionId, session.yourPlayerId);
    renderer.applySettings(settings);
    syncKeybindLabels();
    updateController();

    const disposeRaidSelect = await createRaidHudSelect(net, session.raidId, session.isHost);
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
    await new Promise<void>(resolve => { resolveHome = resolve; });
    resolveHome = null;

    homeBtn.style.display = "none";
    currentTeardown();
    currentTeardown = () => {};
    renderer = null;
    net.send({ type: "releaseSlot", playerId: session.yourPlayerId });
  }
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  Object.assign(pre.style, { color: "red", padding: "1em" });
  pre.textContent = String(err);
  document.body.innerHTML = "";
  document.body.appendChild(pre);
});
