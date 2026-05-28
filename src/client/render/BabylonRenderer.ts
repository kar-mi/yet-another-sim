import { RegisterEnginesExtensionsEngineDynamicTexture } from "@babylonjs/core/Engines/Extensions/engine.dynamicTexture.pure";
import { RegisterEngineUniformBuffer } from "@babylonjs/core/Engines/Extensions/engine.uniformBuffer.pure";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { Renderer } from "./Renderer";
import type { World } from "../../shared/types";
import type { Settings } from "../settings";
import { BossLayer } from "./BossLayer";
import { HealthBarLayer } from "./HealthBarLayer";
import { createZoneMesh } from "./arenaMeshes";
import { HudOverlay } from "./HudOverlay";
import { PlayerLayer } from "./PlayerLayer";
import { TelegraphLayer } from "./TelegraphLayer";
import { TetherLayer } from "./TetherLayer";

// Sub-path imports drop some Babylon engine side-effect registrations.
// Use explicit calls because referenced calls survive tree-shaking.
RegisterEnginesExtensionsEngineDynamicTexture();
// StandardMaterial's WebGL2 UBO path depends on this; without it the scene renders dim/blank.
RegisterEngineUniformBuffer();

const playerBarId = (id: string) => `player:${id}`;
const bossBarId = (id: string) => `boss:${id}`;

export class BabylonRenderer implements Renderer {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private players!: PlayerLayer;
  private boss!: BossLayer;
  private healthBars!: HealthBarLayer;
  private telegraphs!: TelegraphLayer;
  private tethers!: TetherLayer;
  private hud!: HudOverlay;
  private localPlayerId: string | null = null;
  private onResize!: () => void;
  private panButtonCode: number = 2;
  private controllerSensitivity = 2.0;
  private onPanDown!: (e: PointerEvent) => void;
  private onPanUp!: (e: PointerEvent) => void;
  private onLockChange!: () => void;

  constructor(private canvas: HTMLCanvasElement, private onSettingsChange: (settings: Settings) => void = () => {}) {}

  init(world: World, sessionId: string, localPlayerId: string | null = null): void {
    this.localPlayerId = localPlayerId;
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 45, Vector3.Zero(), this.scene);
    this.camera.movement.input.setInteraction("pointer", { button: 0, modifiers: { ctrl: true } }, "rotate");
    this.camera.movement.input.setInteraction("pointer", { button: 2 }, "rotate");
    this.camera.attachControl(false);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 40;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05;
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.onPanDown = (e: PointerEvent) => {
      if (e.button !== this.panButtonCode) return;
      const lockRequest = this.canvas.requestPointerLock();
      if (lockRequest instanceof Promise) lockRequest.catch(() => {});
    };
    this.onPanUp = (e: PointerEvent) => {
      if (e.button !== this.panButtonCode) return;
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    };
    this.onLockChange = () => {
      const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
      if (document.pointerLockElement !== this.canvas && mouseInput) mouseInput.onLostFocus();
    };
    this.canvas.addEventListener("pointerdown", this.onPanDown);
    document.addEventListener("pointerup", this.onPanUp);
    document.addEventListener("pointerlockchange", this.onLockChange);

    new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);

    for (const zone of world.arena.zones) {
      createZoneMesh(this.scene, zone);
    }

    this.players = new PlayerLayer(this.scene);
    this.players.init(world.players);
    this.boss = new BossLayer(this.scene);
    this.boss.init(world.boss);
    this.healthBars = new HealthBarLayer(this.scene);
    for (const player of world.players) {
      const mesh = this.players.getMesh(player.id);
      if (mesh) {
        this.healthBars.link(playerBarId(player.id), mesh, {
          trackWidthPx: 64,
          offsetYPx: -45,
          color: "#35d05c",
        });
      }
    }
    const bossMesh = this.boss.getMesh();
    if (bossMesh) {
      this.healthBars.link(bossBarId(world.boss.id), bossMesh, {
        trackWidthPx: 220,
        offsetYPx: -70,
        color: "#df3333",
      });
    }
    this.telegraphs = new TelegraphLayer(this.scene);
    this.tethers = new TetherLayer(this.scene);
    this.hud = new HudOverlay(sessionId, this.localPlayerId, this.onSettingsChange);

    this.onResize = () => this.engine.resize();
    window.addEventListener("resize", this.onResize);
  }

  sync(world: World, _alpha: number): void {
    this.players.sync(world.players);
    this.boss.sync(world.boss);

    const alive = world.players.find(p => p.id === this.localPlayerId && p.alive)
      ?? world.players.find(p => p.alive);
    if (alive) this.camera.target.set(alive.pos.x, 0, alive.pos.z);

    for (const player of world.players) {
      this.healthBars.set(playerBarId(player.id), player.hp / player.maxHp, player.alive);
    }
    this.healthBars.set(bossBarId(world.boss.id), world.boss.hp / world.boss.maxHp, world.boss.hp > 0);

    this.telegraphs.sync(world.active, world.time);
    this.tethers.sync(world.tetherSources, world.players, world.time);
    this.hud.sync(world);
  }

  render(): void {
    this.scene.render();
  }

  applySettings(s: Settings): void {
    const sens = 2000 / s.mouseSensitivity;
    this.panButtonCode = s.panButton === "right" ? 2 : 0;
    this.controllerSensitivity = s.controllerSensitivity;
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (mouseInput) mouseInput.buttons = [this.panButtonCode];
    this.hud.applySettings(s);
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

  applyControllerPan(dx: number, dy: number, dt: number): void {
    const s = this.controllerSensitivity;
    this.camera.alpha -= dx * s * dt;
    this.camera.beta = Math.max(0.1, Math.min(Math.PI / 2, this.camera.beta - dy * s * dt));
  }

  dispose(): void {
    this.canvas.removeEventListener("pointerdown", this.onPanDown);
    document.removeEventListener("pointerup", this.onPanUp);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    window.removeEventListener("resize", this.onResize);
    this.hud.dispose();
    this.healthBars.dispose();
    this.engine.dispose();
  }
}
