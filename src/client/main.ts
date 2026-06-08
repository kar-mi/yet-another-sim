import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings, setControllerDeadzone, getControllerInfo, listControllers, setActiveGamepad } from "./input";
import { startNetLoop } from "./loop";
import { KEY_BINDING_LABELS } from "./actions";
import { DEFAULT_BINDINGS, keyLabel, loadSettings, saveSettings } from "./settings";
import type { KeyBindings } from "./settings";
import { loadRaidCategories, showLanding, showLobby } from "./MainMenu";
import { connect, type NetClient } from "./net";
import { EMPTY_RAID_ID, SessionIdSchema, type PlaybackState, type RaidCategory } from "../shared/protocol";
import { consoleSink, logger, parseLevel } from "../shared/logger";
import pkg from "../../package.json";

logger.configure({
  level: parseLevel(
    new URLSearchParams(location.search).get("log"),
    "warn",
  ),
  sinks: [consoleSink],
});

async function createRaidHudSelect(net: NetClient, initialRaidId: string, initialIsHost: boolean): Promise<() => void> {
  let isHost = initialIsHost;
  let lastState: PlaybackState = "playing";
  const defaultLobbyCategory: RaidCategory = {
    id: "default-lobby",
    name: "Default Lobby",
    description: "Empty arena.",
    raids: [{ id: EMPTY_RAID_ID, name: "Default Lobby" }],
  };
  const categories = [defaultLobbyCategory, ...await loadRaidCategories()];
  const categoryForRaidId = (raidId: string): RaidCategory => {
    if (raidId === EMPTY_RAID_ID) return defaultLobbyCategory;
    const prefix = raidId.slice(0, raidId.indexOf("/"));
    return categories.find(cat => cat.id === prefix) ?? defaultLobbyCategory;
  };
  let currentCategory = categoryForRaidId(initialRaidId);

  const wrapper = document.createElement("div");
  wrapper.id = "yas-raid-select";

  const categoryBtn = document.createElement("button");
  categoryBtn.type = "button";
  categoryBtn.id = "yas-raid-category-btn";
  categoryBtn.textContent = "☰";
  categoryBtn.ariaLabel = "Choose raid category";

  const label = document.createElement("span");
  label.className = "yas-session-label";
  label.textContent = "RAID";

  const selectDropdown = document.createElement("div");
  selectDropdown.className = "yas-raid-dropdown";
  const select = document.createElement("button");
  select.type = "button";
  select.className = "yas-raid-dropdown-toggle";
  select.ariaLabel = "Raid plan";
  select.disabled = !isHost;
  select.setAttribute("aria-haspopup", "listbox");
  select.setAttribute("aria-expanded", "false");
  const selectOptions = document.createElement("div");
  selectOptions.className = "yas-raid-dropdown-options";
  selectOptions.setAttribute("role", "listbox");
  selectOptions.style.display = "none";
  let activeRaidId = initialRaidId;
  let selectedRaidId = initialRaidId;
  let raidChangePending = false;
  let syncPlayback: (state: PlaybackState) => void = () => {};
  const setSelectOpen = (open: boolean) => {
    if (open && select.disabled) return;
    selectOptions.style.display = open ? "flex" : "none";
    select.setAttribute("aria-expanded", String(open));
  };
  const updateSelectedRaidLabel = (category: RaidCategory) => {
    const selectedRaid = category.raids.find(raid => raid.id === selectedRaidId);
    select.textContent = selectedRaid?.name ?? category.raids[0]?.name ?? "";
  };
  const updateOptionSelection = () => {
    selectOptions.querySelectorAll<HTMLButtonElement>(".yas-raid-dropdown-option").forEach(option => {
      option.setAttribute("aria-selected", String(option.value === selectedRaidId));
    });
  };
  const requestRaidChange = (raidId: string) => {
    if (!raidId) return;
    selectedRaidId = raidId;
    updateSelectedRaidLabel(currentCategory);
    updateOptionSelection();
    setSelectOpen(false);
    select.blur();
    if (raidId === activeRaidId) return;
    raidChangePending = true;
    syncPlayback(lastState);
    net.send({ type: "setRaid", raidId });
  };
  const populateSelect = (category: RaidCategory, selectedId: string) => {
    selectedRaidId = selectedId;
    selectOptions.replaceChildren();
    updateSelectedRaidLabel(category);
    for (const raid of category.raids) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "yas-raid-dropdown-option";
      option.value = raid.id;
      option.textContent = raid.name;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(raid.id === selectedRaidId));
      option.addEventListener("click", () => {
        requestRaidChange(raid.id);
      });
      selectOptions.appendChild(option);
    }
  };
  populateSelect(currentCategory, initialRaidId);
  select.addEventListener("click", () => {
    setSelectOpen(selectOptions.style.display === "none");
  });
  selectDropdown.append(select, selectOptions);

  // Modal listing categories; picking one re-scopes the dropdown (does not change the active raid).
  const modal = document.createElement("div");
  modal.id = "yas-raid-modal";
  modal.style.display = "none";
  const modalPanel = document.createElement("div");
  modalPanel.className = "yas-raid-modal-panel";
  modalPanel.append(
    Object.assign(document.createElement("div"), { className: "yas-menu-subtitle", textContent: "CHOOSE CATEGORY" }),
  );
  const closeModal = () => { modal.style.display = "none"; };
  for (const category of categories) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "yas-raid-cat-option";
    row.append(
      Object.assign(document.createElement("div"), { className: "yas-raid-cat-name", textContent: category.name }),
      Object.assign(document.createElement("div"), { className: "yas-raid-cat-desc", textContent: category.description }),
    );
    row.addEventListener("click", () => {
      currentCategory = category;
      const raidId = category.raids[0]?.id ?? "";
      populateSelect(category, raidId);
      requestRaidChange(raidId);
      closeModal();
    });
    modalPanel.appendChild(row);
  }
  modal.appendChild(modalPanel);
  modal.addEventListener("click", event => { if (event.target === modal) closeModal(); });
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      closeModal();
      setSelectOpen(false);
    }
  };
  const onDocumentClick = (event: MouseEvent) => {
    if (!selectDropdown.contains(event.target as Node)) setSelectOpen(false);
  };
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("click", onDocumentClick);
  document.body.appendChild(modal);

  categoryBtn.addEventListener("click", () => {
    categoryBtn.blur();
    modal.style.display = "flex";
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

  syncPlayback = (state: PlaybackState) => {
    lastState = state;
    const locked = raidChangePending || !isHost || state === "playing";
    select.disabled = locked;
    if (locked) setSelectOpen(false);
    categoryBtn.disabled = locked;
    playBtn.disabled = raidChangePending || !isHost || state === "playing";
    pauseBtn.disabled = raidChangePending || !isHost || state !== "playing";
    stopBtn.disabled = raidChangePending || !isHost || state === "stopped";
    restartBtn.disabled = raidChangePending || !isHost;
  };

  const disposePlayback = net.on("playback", message => {
    isHost = net.clientId === message.hostClientId;
    activeRaidId = message.raidId;
    raidChangePending = false;
    currentCategory = categoryForRaidId(message.raidId);
    populateSelect(currentCategory, message.raidId);
    syncPlayback(message.state);
  });
  const disposeError = net.on("error", () => {
    raidChangePending = false;
    currentCategory = categoryForRaidId(activeRaidId);
    populateSelect(currentCategory, activeRaidId);
    syncPlayback(lastState);
  });
  syncPlayback("playing");

  const selectRow = document.createElement("div");
  selectRow.className = "yas-raid-select-row";
  selectRow.append(categoryBtn, selectDropdown);
  wrapper.append(label, selectRow, controls);
  document.body.appendChild(wrapper);
  return () => {
    disposePlayback();
    disposeError();
    document.removeEventListener("keydown", onKeydown);
    document.removeEventListener("click", onDocumentClick);
    modal.remove();
    wrapper.remove();
  };
}

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  const sessionParam = new URLSearchParams(location.search).get("s");
  const parsedSession = sessionParam ? SessionIdSchema.safeParse(sessionParam.toLowerCase()) : null;

  const net = await connect();
  const settings = loadSettings();
  let renderer: BabylonRenderer | null = null;

  setKeyBindings(settings.keyBindings);
  setControllerDeadzone(settings.controllerDeadzone);

  const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
  const sensitivityVal = document.getElementById("sensitivity-val")!;
  const ctrlSensSlider = document.getElementById("ctrl-sens-slider") as HTMLInputElement;
  const ctrlSensVal = document.getElementById("ctrl-sens-val")!;
  const camAccelToggle = document.getElementById("cam-accel-toggle") as HTMLInputElement;
  const camAccelStrength = document.getElementById("cam-accel-strength") as HTMLInputElement;
  const camAccelStrengthVal = document.getElementById("cam-accel-strength-val")!;
  const panBtns = document.querySelectorAll<HTMLInputElement>('input[name="panBtn"]');
  const uiScaleBtns = document.querySelectorAll<HTMLInputElement>('input[name="uiScale"]');
  const settingsPanel = document.getElementById("settings-panel")!;

  const applyUiScale = (scale: number) => {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  };

  sensitivitySlider.value = String(settings.mouseSensitivity);
  sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
  ctrlSensSlider.value = String(settings.controllerSensitivity);
  ctrlSensVal.textContent = settings.controllerSensitivity.toFixed(1);
  camAccelToggle.checked = settings.cameraAccel;
  camAccelStrength.value = String(settings.cameraAccelStrength);
  camAccelStrengthVal.textContent = settings.cameraAccelStrength.toFixed(1);
  panBtns.forEach(btn => { btn.checked = btn.value === settings.panButton; });
  uiScaleBtns.forEach(btn => { btn.checked = parseFloat(btn.value) === settings.uiScale; });
  applyUiScale(settings.uiScale);

  const syncKeybindLabels = () => {
    document.querySelectorAll<HTMLElement>(".keybind-row").forEach(row => {
      const action = row.dataset.action as keyof KeyBindings;
      const label = row.querySelector<HTMLElement>(".keybind-label");
      if (label) label.textContent = KEY_BINDING_LABELS[action];
    });
    document.querySelectorAll<HTMLButtonElement>(".keybind-btn").forEach(btn => {
      const action = btn.dataset.action as keyof KeyBindings;
      btn.textContent = keyLabel(settings.keyBindings[action]);
    });
  };
  syncKeybindLabels();

  // Hide the gameplay HUD (hotbar + HP/MP bars) while the settings panel is open.
  const setHudHidden = (hidden: boolean) => {
    const hud = document.getElementById("yas-hud");
    if (hud) hud.style.display = hidden ? "none" : "";
  };

  document.getElementById("settings-btn")!.addEventListener("click", () => {
    settingsPanel.style.display = "block";
    setHudHidden(true);
  });
  document.getElementById("settings-close")!.addEventListener("click", () => {
    settingsPanel.style.display = "none";
    setHudHidden(false);
  });

  const infoPanel = document.getElementById("info-panel")!;
  document.getElementById("info-version")!.textContent = `v${pkg.version}`;
  document.getElementById("info-btn")!.addEventListener("click", () => {
    infoPanel.style.display = "block";
    setHudHidden(true);
  });
  document.getElementById("info-close")!.addEventListener("click", () => {
    infoPanel.style.display = "none";
    setHudHidden(false);
  });

  sensitivitySlider.addEventListener("input", () => {
    settings.mouseSensitivity = parseFloat(sensitivitySlider.value);
    sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
    saveSettings(settings);
    renderer?.applySettings(settings);
  });

  ctrlSensSlider.addEventListener("input", () => {
    settings.controllerSensitivity = parseFloat(ctrlSensSlider.value);
    ctrlSensVal.textContent = settings.controllerSensitivity.toFixed(1);
    saveSettings(settings);
    renderer?.applySettings(settings);
  });

  camAccelToggle.addEventListener("change", () => {
    settings.cameraAccel = camAccelToggle.checked;
    saveSettings(settings);
    renderer?.applySettings(settings);
  });

  camAccelStrength.addEventListener("input", () => {
    settings.cameraAccelStrength = parseFloat(camAccelStrength.value);
    camAccelStrengthVal.textContent = settings.cameraAccelStrength.toFixed(1);
    saveSettings(settings);
    renderer?.applySettings(settings);
  });

  uiScaleBtns.forEach(btn => {
    btn.addEventListener("change", () => {
      if (btn.checked) {
        settings.uiScale = parseFloat(btn.value);
        saveSettings(settings);
        applyUiScale(settings.uiScale);
      }
    });
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
      document.querySelectorAll<HTMLElement>("[id^='tab-']").forEach(panel => {
        panel.style.display = panel.id === `tab-${target}` ? "" : "none";
      });
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

  // Resolve the session id only after the settings handlers are wired, so the ⚙ panel
  // also works on the landing page (base URL with no ?s= param).
  const sessionId = parsedSession?.success ? parsedSession.data : await showLanding();

  // Each iteration is one sim session: pick a class in the lobby, play, click Home to come back.
  for (;;) {
    homeBtn.style.display = "none";
    const session = await showLobby(net, sessionId);

    renderer = new BabylonRenderer(canvas, nextSettings => {
      Object.assign(settings, nextSettings);
      saveSettings(settings);
    }, position => {
      net.send({ type: "debugPosition", ...position });
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
  logger.error("app", "fatal", { err });
  const pre = document.createElement("pre");
  Object.assign(pre.style, { color: "red", padding: "1em" });
  pre.textContent = String(err);
  document.body.innerHTML = "";
  document.body.appendChild(pre);
});
