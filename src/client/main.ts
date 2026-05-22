import { loadRaid } from "../engine/raidLoader";
import { createWorld } from "../engine/world";
import { BabylonRenderer } from "./render/BabylonRenderer";
import { initInput } from "./input";
import { startLoop } from "./loop";
import { loadSettings, saveSettings } from "./settings";

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

  const sensitivitySlider = document.getElementById("sensitivity-slider") as HTMLInputElement;
  const sensitivityVal = document.getElementById("sensitivity-val")!;
  const panBtns = document.querySelectorAll<HTMLInputElement>('input[name="panBtn"]');
  const settingsPanel = document.getElementById("settings-panel")!;

  sensitivitySlider.value = String(settings.mouseSensitivity);
  sensitivityVal.textContent = settings.mouseSensitivity.toFixed(1);
  panBtns.forEach(btn => { btn.checked = btn.value === settings.panButton; });

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
