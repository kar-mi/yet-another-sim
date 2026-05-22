import { loadRaid } from "../engine/raidLoader";
import { createWorld } from "../engine/world";
import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput, setKeyBindings } from "./input";
import { startLoop } from "./loop";
import { DEFAULT_BINDINGS, keyLabel, loadSettings, saveSettings } from "./settings";
import type { KeyBindings } from "./settings";

async function main(): Promise<void> {
  const canvas = document.getElementById("canvas") as HTMLCanvasElement | null;
  if (!canvas) throw new Error("#canvas not found");

  const res = await fetch("/raids/sample-raid.json");
  if (!res.ok) throw new Error(`Failed to load raid: ${res.status}`);
  const json: unknown = await res.json();

  const raid = loadRaid(json);
  const world = createWorld(raid);

  const renderer = new BabylonRenderer(canvas);
  renderer.init(world);

  const settings = loadSettings();
  renderer.applySettings(settings);
  setKeyBindings(settings.keyBindings);

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
  const stopLoop = startLoop(world, renderer, world.players[0].id);

  // HMR cleanup (Bun --hot)
  const meta = import.meta as unknown as { hot?: { dispose: (cb: () => void) => void } };
  meta.hot?.dispose(() => {
    stopLoop();
    disposeInput();
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
