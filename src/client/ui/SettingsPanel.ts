import { listControllers, getControllerInfo, setActiveGamepad, setKeyBindings, setControlScheme } from "../input";
import { ACTIONS, CONTROLLER_BUTTON_LABELS, KEY_BINDING_LABELS } from "../actions";
import { DEFAULT_BINDINGS, keyLabel, saveSettings } from "../settings";
import type { ActionId } from "../actions";
import type { ControllerType, KeyBindings, Settings } from "../settings";
import type { BabylonRenderer } from "../render/BabylonRenderer";
import pkg from "../../../package.json";

/**
 * Wires the settings/options panel, info panel, controller detection and keybind
 * rebinding to a persisted `settings` object. The renderer is created after this
 * runs, so live-apply goes through the `getRenderer` accessor.
 *
 * Returns hooks the session loop re-invokes when a new session starts.
 */
export function initSettingsPanel(
  settings: Settings,
  getRenderer: () => BabylonRenderer | null,
): { syncKeybindLabels: () => void; updateController: () => void } {
  const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
  const sensitivityVal = document.getElementById("sensitivity-val")!;
  const ctrlSensSlider = document.getElementById("ctrl-sens-slider") as HTMLInputElement;
  const ctrlSensVal = document.getElementById("ctrl-sens-val")!;
  const camAccelToggle = document.getElementById("cam-accel-toggle") as HTMLInputElement;
  const camAccelStrength = document.getElementById("cam-accel-strength") as HTMLInputElement;
  const camAccelStrengthVal = document.getElementById("cam-accel-strength-val")!;
  const schemeBtns = document.querySelectorAll<HTMLInputElement>('input[name="controlScheme"]');
  const uiScaleBtns = document.querySelectorAll<HTMLInputElement>('input[name="uiScale"]');
  const settingsPanel = document.getElementById("settings-panel")!;
  let currentControllerType: ControllerType = "unknown";

  const applyUiScale = (scale: number) => {
    document.documentElement.style.setProperty("--ui-scale", String(scale));
  };

  const isActionId = (action: string | undefined): action is ActionId => {
    return !!action && action in ACTIONS;
  };

  sensitivitySlider.value = String(settings.mouseSensitivity);
  sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
  ctrlSensSlider.value = String(settings.controllerSensitivity);
  ctrlSensVal.textContent = settings.controllerSensitivity.toFixed(1);
  camAccelToggle.checked = settings.cameraAccel;
  camAccelStrength.value = String(settings.cameraAccelStrength);
  camAccelStrengthVal.textContent = settings.cameraAccelStrength.toFixed(1);
  schemeBtns.forEach(btn => { btn.checked = btn.value === settings.controlScheme; });
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
    const controllerLabels = CONTROLLER_BUTTON_LABELS[currentControllerType];
    document.querySelectorAll<HTMLElement>(".keybind-controller").forEach(label => {
      if (label.dataset.controllerLabel) {
        label.textContent = label.dataset.controllerLabel;
        return;
      }
      const action = label.dataset.action;
      label.textContent = isActionId(action) ? controllerLabels[ACTIONS[action].controllerSlot] ?? "" : "";
    });
  };
  syncKeybindLabels();

  // Hide the gameplay HUD (hotbar + HP/MP bars) while a panel is open.
  const setHudHidden = (hidden: boolean) => {
    const hud = document.getElementById("yas-hud");
    if (hud) hud.style.display = hidden ? "none" : "";
  };

  // A slider that persists a numeric setting and live-applies it to the renderer.
  const bindSlider = (input: HTMLInputElement, valEl: HTMLElement, apply: (value: number) => void) => {
    input.addEventListener("input", () => {
      const value = parseFloat(input.value);
      valEl.textContent = value.toFixed(1);
      apply(value);
      saveSettings(settings);
      getRenderer()?.applySettings(settings);
    });
  };

  // An open/close button pair that shows a panel and toggles the gameplay HUD.
  const bindPanel = (openBtnId: string, closeBtnId: string, panel: HTMLElement) => {
    document.getElementById(openBtnId)!.addEventListener("click", () => {
      panel.style.display = "block";
      setHudHidden(true);
    });
    document.getElementById(closeBtnId)!.addEventListener("click", () => {
      panel.style.display = "none";
      setHudHidden(false);
    });
  };

  const infoPanel = document.getElementById("info-panel")!;
  document.getElementById("info-version")!.textContent = `v${pkg.version}`;
  bindPanel("settings-btn", "settings-close", settingsPanel);
  bindPanel("info-btn", "info-close", infoPanel);

  bindSlider(sensitivitySlider, sensitivityVal, value => { settings.mouseSensitivity = value; });
  bindSlider(ctrlSensSlider, ctrlSensVal, value => { settings.controllerSensitivity = value; });
  bindSlider(camAccelStrength, camAccelStrengthVal, value => { settings.cameraAccelStrength = value; });

  camAccelToggle.addEventListener("change", () => {
    settings.cameraAccel = camAccelToggle.checked;
    saveSettings(settings);
    getRenderer()?.applySettings(settings);
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

  schemeBtns.forEach(btn => {
    btn.addEventListener("change", () => {
      if (btn.checked) {
        settings.controlScheme = btn.value as "legacy" | "standard";
        saveSettings(settings);
        setControlScheme(settings.controlScheme);
        getRenderer()?.applySettings(settings);
      }
    });
  });

  document.getElementById("reset-keybinds")!.addEventListener("click", () => {
    settings.keyBindings = { ...DEFAULT_BINDINGS };
    syncKeybindLabels();
    saveSettings(settings);
    setKeyBindings(settings.keyBindings);
    getRenderer()?.applySettings(settings);
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
      currentControllerType = info.type;
      getRenderer()?.setControllerType(info.type);
    } else {
      controllerBadge.textContent = "NO CONTROLLER";
      controllerBadge.className = "controller-badge controller-badge--none";
      controllerName.textContent = "";
      currentControllerType = "unknown";
    }
    syncKeybindLabels();
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
          getRenderer()?.applySettings(settings);
        }
        btn.classList.remove("keybind-listening");
        window.removeEventListener("keydown", onKey, true);
      };
      window.addEventListener("keydown", onKey, true);
    });
  });

  return { syncKeybindLabels, updateController };
}
