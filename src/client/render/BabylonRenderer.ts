import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color4,
} from "@babylonjs/core";
import type { Renderer } from "./Renderer";
import type { World } from "../../shared/types";
import type { Settings } from "../settings";
import { createZoneMesh } from "./arenaMeshes";
import { HudOverlay } from "./HudOverlay";
import { PlayerLayer } from "./PlayerLayer";
import { TelegraphLayer } from "./TelegraphLayer";

export class BabylonRenderer implements Renderer {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private players!: PlayerLayer;
  private telegraphs!: TelegraphLayer;
  private hud!: HudOverlay;
  private onResize!: () => void;

  constructor(private canvas: HTMLCanvasElement) {}

  init(world: World): void {
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 45, Vector3.Zero(), this.scene);
    // Disable Babylon's right-click panning so the configured mouse button always orbits.
    this.camera.attachControl(true, false, -1);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 40;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05;
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());

    new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);

    for (const zone of world.arena.zones) {
      createZoneMesh(this.scene, zone);
    }

    this.players = new PlayerLayer(this.scene);
    this.players.init(world.players);
    this.telegraphs = new TelegraphLayer(this.scene);
    this.hud = new HudOverlay();

    this.engine.runRenderLoop(() => this.scene.render());
    this.onResize = () => this.engine.resize();
    window.addEventListener("resize", this.onResize);
  }

  sync(world: World, _alpha: number): void {
    this.players.sync(world.players);

    const alive = world.players.find(p => p.alive);
    if (alive) this.camera.target.set(alive.pos.x, 0, alive.pos.z);

    this.telegraphs.sync(world.active, world.time);
    this.hud.sync(world);
  }

  applySettings(s: Settings): void {
    const sens = 2000 / s.mouseSensitivity;
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    const mouseInput = (this.camera.inputs.attached as any).pointers;
    if (mouseInput) mouseInput.buttons = s.panButton === "right" ? [2] : [0];
    this.hud.applySettings(s);
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.hud.dispose();
    this.engine.dispose();
  }
}
