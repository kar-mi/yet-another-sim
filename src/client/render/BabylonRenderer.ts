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
import { createZoneMesh } from "./meshes/arenaMeshes";
import { HudOverlay } from "../ui/HudOverlay";
import { PlayerLayer } from "./PlayerLayer";
import { TelegraphLayer } from "./TelegraphLayer";
import { TetherLayer } from "./TetherLayer";
import { LineLinkLayer } from "./LineLinkLayer";
import { ChainLayer } from "./ChainLayer";
import { TowerLayer } from "./TowerLayer";
import { StackLayer } from "./StackLayer";
import { InverseLayer } from "./InverseLayer";
import { SpreadStackLayer } from "./SpreadStackLayer";
import { GazeLayer } from "./GazeLayer";
import { ForcedMarchLayer } from "./ForcedMarchLayer";
import { WaymarkLayer } from "./WaymarkLayer";
import { setControlScheme } from "../input";
import { computeWorldRenderKeys, getWorldRenderKeys } from "../worldRenderKeys";

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
  private spreadStacks!: SpreadStackLayer;
  private gaze!: GazeLayer;
  private forcedMarches!: ForcedMarchLayer;
  private waymarks!: WaymarkLayer;
  private hud!: HudOverlay;
  private floorMeshes: Mesh[] = [];
  private arenaKey = "";
  private localPlayerId: string | null = null;
  private spectateTargetId: string | null = null;
  private onResize!: () => void;
  private panButtons = { left: false, right: false };
  private controllerSensitivity = 2.0;
  private cameraAccel = false;
  private cameraAccelStrength = 1;
  private renderedPlayerHealthBars = true;
  private camAccelFactor = 1;
  private onPanDown!: (e: PointerEvent) => void;
  private onPanUp!: (e: PointerEvent) => void;
  private onLockChange!: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSettingsChange: (settings: Settings) => void = () => {},
    private onDebugPosition: (position: { playerId: string; x: number; y: number; z: number }) => void = () => {},
  ) {}

  init(world: World, sessionId: string, localPlayerId: string | null = null): void {
    this.localPlayerId = localPlayerId;
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), this.scene);
    this.camera.movement.input.setInteraction("pointer", { button: 0 }, "rotate");
    this.camera.movement.input.setInteraction("pointer", { button: 2 }, "rotate");
    this.camera.attachControl(false);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 30;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05;
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());

    this.onPanDown = (e: PointerEvent) => {
      if (e.button === 0) this.panButtons.left = true;
      else if (e.button === 2) this.panButtons.right = true;
      else return;
      const lockRequest = this.canvas.requestPointerLock();
      if (lockRequest instanceof Promise) lockRequest.catch(() => {});
    };
    this.onPanUp = (e: PointerEvent) => {
      if (e.button === 0) this.panButtons.left = false;
      else if (e.button === 2) this.panButtons.right = false;
      else return;
      // Release the pointer lock only once both drag buttons are up.
      if (!this.panButtons.left && !this.panButtons.right && document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    };
    this.onLockChange = () => {
      const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
      if (document.pointerLockElement !== this.canvas) {
        // Lock lost (e.g. Esc) without a pointerup — clear drag state so it doesn't stick.
        this.panButtons.left = false;
        this.panButtons.right = false;
        if (mouseInput) mouseInput.onLostFocus();
      }
    };
    this.canvas.addEventListener("pointerdown", this.onPanDown);
    document.addEventListener("pointerup", this.onPanUp);
    document.addEventListener("pointerlockchange", this.onLockChange);

    new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);

    const renderKeys = getWorldRenderKeys(world) ?? computeWorldRenderKeys(world);
    this.buildArena(world.arena.zones, renderKeys.arena);
    this.waymarks = new WaymarkLayer(this.scene);
    this.waymarks.sync(world.waymarks, renderKeys.waymarks);

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
          offsetForwardWorld: 0.8,
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
    this.spreadStacks = new SpreadStackLayer(this.scene);
    this.gaze = new GazeLayer(this.scene);
    this.forcedMarches = new ForcedMarchLayer(this.scene);
    this.hud = new HudOverlay(
      sessionId,
      this.localPlayerId,
      this.onSettingsChange,
      id => this.setSpectateTarget(id),
      this.onDebugPosition,
    );

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

  sync(world: World): void {
    const renderKeys = getWorldRenderKeys(world) ?? computeWorldRenderKeys(world);
    if (renderKeys.arena !== this.arenaKey) this.buildArena(world.arena.zones, renderKeys.arena);
    this.waymarks.sync(world.waymarks, renderKeys.waymarks);

    this.players.sync(world.players, world.time);
    this.boss.sync(world.boss);
    this.bossRing.sync(world.boss);

    const local = world.players.find(p => p.id === this.localPlayerId);
    const focus = local?.alive
      ? local
      : (world.players.find(p => p.id === this.spectateTargetId && p.alive)
          ?? world.players.find(p => p.alive));
    if (focus) this.camera.target.set(focus.pos.x, 0, focus.pos.z);

    for (const player of world.players) {
      this.healthBars.set(playerBarId(player.id), player.hp / player.maxHp, player.alive && this.renderedPlayerHealthBars);
    }
    this.healthBars.set(bossBarId(world.boss.id), world.boss.hp / world.boss.maxHp, world.boss.hp > 0);

    this.telegraphs.sync(world.active, world.time);
    this.tethers.sync(world.tetherSources, world.players, world.time);
    this.lineLinks.sync(world.lineLinks, world.players, world.time);
    this.chains.sync(world.chains, world.players);
    this.towers.sync(world.towers, world.time);
    this.stacks.sync(world.groupMechanics, world.players, world.time);
    this.inverse.sync(world.inversions, world.boss, world.time);
    this.spreadStacks.sync(world.spreadStacks, world.boss, world.players, world.time);
    this.gaze.sync(world.gazes, world.time);
    this.forcedMarches.sync(world.forcedMarches, world.time);
    this.hud.sync(world);
  }

  render(): void {
    this.scene.render();
  }

  applySettings(s: Settings): void {
    const sens = 2000 / s.mouseSensitivity;
    this.controllerSensitivity = s.controllerSensitivity;
    this.cameraAccel = s.cameraAccel;
    this.cameraAccelStrength = s.cameraAccelStrength;
    this.renderedPlayerHealthBars = s.renderedPlayerHealthBars;
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    // Both mouse buttons drag-rotate the camera; facing rules differ per scheme (handled in input.ts).
    const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (mouseInput) mouseInput.buttons = [0, 2];
    setControlScheme(s.controlScheme);
    this.hud.applySettings(s);
  }

  setSpectateTarget(id: string): void {
    this.spectateTargetId = id;
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

  // Rotates the orbit camera by a yaw delta (radians). alpha runs opposite to yaw
  // (see getCameraYaw), so we subtract. Used for A/D pan + Standard auto-trail.
  rotateCameraYaw(delta: number): void {
    this.camera.alpha -= delta;
  }

  getPanButtons(): { left: boolean; right: boolean } {
    return this.panButtons;
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
    this.spreadStacks.dispose();
    this.gaze.dispose();
    this.forcedMarches.dispose();
    this.waymarks.dispose();
    this.healthBars.dispose();
    this.engine.dispose();
  }
}
