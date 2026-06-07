import { RegisterEnginesExtensionsEngineDynamicTexture } from "@babylonjs/core/Engines/Extensions/engine.dynamicTexture.pure";
import { RegisterEngineUniformBuffer } from "@babylonjs/core/Engines/Extensions/engine.uniformBuffer.pure";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Renderer } from "./Renderer";
import type { World, ZoneShape } from "../../shared/types";
import type { Settings, ControllerType } from "../settings";
import { BossLayer } from "./BossLayer";
import { BossRingLayer } from "./BossRingLayer";
import { HealthBarLayer } from "./HealthBarLayer";
import { createZoneMesh } from "./arenaMeshes";
import { HudOverlay } from "./HudOverlay";
import { PlayerLayer } from "./PlayerLayer";
import { TelegraphLayer } from "./TelegraphLayer";
import { TetherLayer } from "./TetherLayer";
import { LineLinkLayer } from "./LineLinkLayer";
import { ChainLayer } from "./ChainLayer";
import { TowerLayer } from "./TowerLayer";
import { StackLayer } from "./StackLayer";
import { InverseLayer } from "./InverseLayer";
import { GazeLayer } from "./GazeLayer";
import { WaymarkLayer } from "./WaymarkLayer";

// Sub-path imports drop some Babylon engine side-effect registrations.
// Use explicit calls because referenced calls survive tree-shaking.
RegisterEnginesExtensionsEngineDynamicTexture();
// StandardMaterial's WebGL2 UBO path depends on this; without it the scene renders dim/blank.
RegisterEngineUniformBuffer();

const playerBarId = (id: string) => `player:${id}`;
const bossBarId = (id: string) => `boss:${id}`;

// Rate at which controller-camera acceleration ramps toward its target multiplier (~reaches it in <1s).
const CAMERA_ACCEL_RAMP = 3;

export class BabylonRenderer implements Renderer {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private players!: PlayerLayer;
  private boss!: BossLayer;
  private bossRing!: BossRingLayer;
  private healthBars!: HealthBarLayer;
  private telegraphs!: TelegraphLayer;
  private tethers!: TetherLayer;
  private lineLinks!: LineLinkLayer;
  private chains!: ChainLayer;
  private towers!: TowerLayer;
  private stacks!: StackLayer;
  private inverse!: InverseLayer;
  private gaze!: GazeLayer;
  private waymarks!: WaymarkLayer;
  private hud!: HudOverlay;
  private floorMeshes: Mesh[] = [];
  private arenaKey = "";
  private localPlayerId: string | null = null;
  private spectateTargetId: string | null = null;
  private onResize!: () => void;
  private panButtonCode: number = 2;
  private controllerSensitivity = 2.0;
  private cameraAccel = false;
  private cameraAccelStrength = 1;
  private camAccelFactor = 1;
  private onPanDown!: (e: PointerEvent) => void;
  private onPanUp!: (e: PointerEvent) => void;
  private onLockChange!: () => void;

  constructor(private canvas: HTMLCanvasElement, private onSettingsChange: (settings: Settings) => void = () => {}) {}

  init(world: World, sessionId: string, localPlayerId: string | null = null): void {
    this.localPlayerId = localPlayerId;
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), this.scene);
    this.camera.movement.input.setInteraction("pointer", { button: 0, modifiers: { ctrl: true } }, "rotate");
    this.camera.movement.input.setInteraction("pointer", { button: 2 }, "rotate");
    this.camera.attachControl(false);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 30;
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

    this.buildArena(world.arena.zones, JSON.stringify(world.arena.zones));
    this.waymarks = new WaymarkLayer(this.scene);
    this.waymarks.sync(world.waymarks);

    this.players = new PlayerLayer(this.scene);
    this.players.init(world.players);
    this.boss = new BossLayer(this.scene);
    this.boss.init(world.boss);
    this.bossRing = new BossRingLayer(this.scene);
    this.bossRing.sync(world.boss);
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
    this.lineLinks = new LineLinkLayer(this.scene);
    this.chains = new ChainLayer(this.scene);
    this.towers = new TowerLayer(this.scene);
    this.stacks = new StackLayer(this.scene);
    this.inverse = new InverseLayer(this.scene);
    this.gaze = new GazeLayer(this.scene);
    this.hud = new HudOverlay(sessionId, this.localPlayerId, this.onSettingsChange, id => this.setSpectateTarget(id));

    this.onResize = () => this.engine.resize();
    window.addEventListener("resize", this.onResize);
  }

  private buildArena(zones: ZoneShape[], key: string): void {
    for (const mesh of this.floorMeshes) mesh.dispose(false, true);
    this.floorMeshes = [];
    for (const zone of zones) {
      const mesh = createZoneMesh(this.scene, zone);
      if (mesh) this.floorMeshes.push(mesh);
    }
    this.arenaKey = key;
  }

  sync(world: World, _alpha: number): void {
    const arenaKey = JSON.stringify(world.arena.zones);
    if (arenaKey !== this.arenaKey) this.buildArena(world.arena.zones, arenaKey);
    this.waymarks.sync(world.waymarks);

    this.players.sync(world.players);
    this.boss.sync(world.boss);
    this.bossRing.sync(world.boss);

    const local = world.players.find(p => p.id === this.localPlayerId);
    const focus = local?.alive
      ? local
      : (world.players.find(p => p.id === this.spectateTargetId && p.alive)
          ?? world.players.find(p => p.alive));
    if (focus) this.camera.target.set(focus.pos.x, 0, focus.pos.z);

    for (const player of world.players) {
      this.healthBars.set(playerBarId(player.id), player.hp / player.maxHp, player.alive);
    }
    this.healthBars.set(bossBarId(world.boss.id), world.boss.hp / world.boss.maxHp, world.boss.hp > 0);

    this.telegraphs.sync(world.active, world.time);
    this.tethers.sync(world.tetherSources, world.players, world.time);
    this.lineLinks.sync(world.lineLinks, world.players, world.time);
    this.chains.sync(world.chains, world.players, world.time);
    this.towers.sync(world.towers, world.time);
    this.stacks.sync(world.groupMechanics, world.players, world.time);
    this.inverse.sync(world.inversions, world.boss, world.time);
    this.gaze.sync(world.gazes, world.time);
    this.hud.sync(world);
  }

  render(): void {
    this.scene.render();
  }

  applySettings(s: Settings): void {
    const sens = 2000 / s.mouseSensitivity;
    this.panButtonCode = s.panButton === "right" ? 2 : 0;
    this.controllerSensitivity = s.controllerSensitivity;
    this.cameraAccel = s.cameraAccel;
    this.cameraAccelStrength = s.cameraAccelStrength;
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (mouseInput) mouseInput.buttons = [this.panButtonCode];
    this.hud.applySettings(s);
  }

  setSpectateTarget(id: string): void {
    this.spectateTargetId = id;
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

  setControllerType(type: ControllerType): void {
    this.hud.setControllerType(type);
  }

  applyControllerPan(dx: number, dy: number, dt: number): void {
    let s = this.controllerSensitivity;
    if (this.cameraAccel) {
      const target = Math.hypot(dx, dy) > 0 ? 1 + this.cameraAccelStrength : 1;
      this.camAccelFactor += (target - this.camAccelFactor) * Math.min(1, dt * CAMERA_ACCEL_RAMP);
    } else {
      this.camAccelFactor = 1;
    }
    s *= this.camAccelFactor;
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
    this.bossRing.dispose();
    this.lineLinks.dispose();
    this.chains.dispose();
    this.towers.dispose();
    this.stacks.dispose();
    this.inverse.dispose();
    this.gaze.dispose();
    this.waymarks.dispose();
    this.healthBars.dispose();
    this.engine.dispose();
  }
}
