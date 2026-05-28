import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings, setControllerDeadzone } from "./input";
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
  const { world, yourPlayerId, raidId, isHost } = await showLobby(net, sessionId);
  const settings = loadSettings();
  const renderer = new BabylonRenderer(canvas, nextSettings => {
    Object.assign(settings, nextSettings);
    saveSettings(settings);
  });
  renderer.init(world, sessionId, yourPlayerId);
  const disposeRaidSelect = await createRaidHudSelect(net, raidId, isHost);

  renderer.applySettings(settings);
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
    renderer.applySettings(settings);
  });

  panBtns.forEach(btn => {
    btn.addEventListener("change", () => {
      if (btn.checked) {
        settings.panButton = btn.value as "left" | "right";
        saveSettings(settings);
        renderer.applySettings(settings);
      }
    });
  });

  document.getElementById("reset-keybinds")!.addEventListener("click", () => {
    settings.keyBindings = { ...DEFAULT_BINDINGS };
    syncKeybindLabels();
    saveSettings(settings);
    setKeyBindings(settings.keyBindings);
    renderer.applySettings(settings);
  });

  // Tab switching
  document.querySelectorAll<HTMLButtonElement>(".settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      const target = tab.dataset.tab!;
      (document.getElementById("tab-camera") as HTMLElement).style.display = target === "camera" ? "" : "none";
      (document.getElementById("tab-controls") as HTMLElement).style.display = target === "controls" ? "" : "none";
    });
  });

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
          renderer.applySettings(settings);
        }
        btn.classList.remove("keybind-listening");
        window.removeEventListener("keydown", onKey, true);
      };
      window.addEventListener("keydown", onKey, true);
    });
  });

  const disposeInput = initInput();
  const stopLoop = startNetLoop(renderer, net);

  // HMR cleanup (Bun --hot)
  const meta = import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } };
  meta.hot?.dispose(() => {
    stopLoop();
    disposeInput();
    disposeRaidSelect();
    net.close();
    renderer.dispose();
  });
}

main().catch((err) => {
  console.error(err);
  const pre = document.createElement("pre");
  Object.assign(pre.style, { color: "red", padding: "1em" });
  pre.textContent = String(err);
  document.body.innerHTML = "";
  document.body.appendChild(pre);
});
