import { RegisterFullEngineExtensions } from "@babylonjs/core/Engines/engineRegistration.pure";
import { RegisterAnimatable } from "@babylonjs/core/Animations/animatable.pure";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import type { ArcRotateCameraPointersInput } from "@babylonjs/core/Cameras/Inputs/arcRotateCameraPointersInput";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Arena } from "@arena";
import { createArenaMeshes } from "@arena/babylon";
import type { Renderer } from "./Renderer";
import type { ActiveDivebomb, ActiveForcedMarch, ActiveHazard, ActiveTower, Boss, World } from "@model/types";
import type { PlaybackState } from "@model/protocol";
import { selectBossSideOrbs } from "./bossSideOrbs";
import { selectSealedImplement } from "./sealedImplement";
import type { Settings, ControllerType } from "../settings";
import { BossLayer } from "./BossLayer";
import { BossRingLayer } from "./BossRingLayer";
import { BossSideOrbLayer } from "./BossSideOrbLayer";
import { TargetRingLayer } from "./TargetRingLayer";
import { HealthBarLayer } from "./HealthBarLayer";
import { ARENA_IMAGE_ROOT } from "../staticBase";
import { HudOverlay } from "../ui/HudOverlay";
import { PlayerLayer } from "./PlayerLayer";
import { TelegraphLayer } from "./TelegraphLayer";
import { TetherLayer } from "./TetherLayer";
import { LineLinkLayer } from "./LineLinkLayer";
import { ChainLayer } from "./ChainLayer";
import { StackLayer } from "./StackLayer";
import { InverseLayer } from "./InverseLayer";
import { SpreadStackLayer } from "./SpreadStackLayer";
import { GazeLayer } from "./GazeLayer";
import { HandLayer } from "./HandLayer";
import { KeyedMeshLayer } from "./KeyedMeshLayer";
import { createTowerMeshes, updateTowerMeshes, type TowerMeshes } from "./meshes/towerMeshes";
import { createForcedMarchMeshes, updateForcedMarchMeshes, type ForcedMarchMeshes } from "./meshes/forcedMarchMeshes";
import { createHazardMeshes, updateHazardMeshes, type HazardMeshes } from "./meshes/hazardMeshes";
import { createDivebombMeshes, updateDivebombMeshes, type DivebombMeshes } from "./meshes/divebombMeshes";
import { ElementGlyphLayer } from "./ElementGlyphLayer";
import { ElementRingLayer } from "./ElementRingLayer";
import { MoverLayer } from "./MoverLayer";
import { PlayerEffectRingLayer } from "./PlayerEffectRingLayer";
import { CountdownPieLayer } from "./CountdownPieLayer";
import { WaymarkLayer } from "./WaymarkLayer";
import { CrystalLayer } from "./CrystalLayer";
import { setControlScheme } from "../input";
import { computeWorldRenderKeys, getWorldRenderKeys } from "../worldRenderKeys";
import type { HudLayoutManager } from "../ui/HudLayoutManager";
import { prewarmShaders } from "@effects/babylon";
import { buildCastCandidates, CAST_BAR_COLOR, castForBoss } from "../ui/hudPresentation";
import { resolvePovPlayer } from "../pov";

RegisterFullEngineExtensions();
RegisterAnimatable();

const playerBarId = (id: string) => `player:${id}`;
const bossCastBarId = (id: string) => `boss-cast:${id}`;
const bossLayersKey = (bosses: Boss[]) =>
  bosses.map(b => `${b.id}|${b.model}|${b.modelScale}|${b.radius}|${b.ringScale}|${b.ringColor}`).join(",");

const CAMERA_ACCEL_RAMP = 3;
const MAX_DEVICE_RATIO = 2;

export class BabylonRenderer implements Renderer {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private players!: PlayerLayer;
  private bossLayers = new Map<string, BossLayer>();
  private bossRingLayers = new Map<string, BossRingLayer>();
  private bossSideOrbLayers = new Map<string, BossSideOrbLayer>();
  private targetRingLayers = new Map<string, TargetRingLayer>();
  private bossesKey = "";
  private bossIds: string[] = [];
  private healthBars!: HealthBarLayer;
  private telegraphs!: TelegraphLayer;
  private tethers!: TetherLayer;
  private lineLinks!: LineLinkLayer;
  private chains!: ChainLayer;
  private towers!: KeyedMeshLayer<ActiveTower, TowerMeshes>;
  private stacks!: StackLayer;
  private inverse!: InverseLayer;
  private spreadStacks!: SpreadStackLayer;
  private gaze!: GazeLayer;
  private hands!: HandLayer;
  private forcedMarches!: KeyedMeshLayer<ActiveForcedMarch, ForcedMarchMeshes>;
  private hazards!: KeyedMeshLayer<ActiveHazard, HazardMeshes>;
  private divebombs!: KeyedMeshLayer<ActiveDivebomb, DivebombMeshes>;
  private elementGlyphs!: ElementGlyphLayer;
  private elementRings!: ElementRingLayer;
  private movers!: MoverLayer;
  private effectRings!: PlayerEffectRingLayer;
  private countdownPie!: CountdownPieLayer;
  private waymarks!: WaymarkLayer;
  private crystals!: CrystalLayer;
  private hud!: HudOverlay;
  private owned: { dispose(): void }[] = [];
  private floorMeshes: Mesh[] = [];
  private arenaKey = "";
  private localPlayerId: string | null = null;
  private spectateTargetId: string | null = null;
  private onResize!: () => void;
  private panButtons = { left: false, right: false };
  private swallowNextLockedMove = false;
  private controllerSensitivity = 2.0;
  private cameraAccel = false;
  private cameraAccelStrength = 1;
  private renderedPlayerHealthBars = false;
  private renderScale = 1;
  private botsInvisibleOverride: boolean | null = null;
  private camAccelFactor = 1;
  private onPanDown!: (e: PointerEvent) => void;
  private onPanUp!: (e: PointerEvent) => void;
  private onLockChange!: () => void;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSettingsChange: (settings: Settings) => void,
    private onDebugPosition: (position: { playerId: string; x: number; y: number; z: number }) => void,
    private botsButton: HTMLButtonElement | null,
    private hudLayout: HudLayoutManager,
  ) {}

  init(world: World, sessionId: string, localPlayerId: string | null = null): void {
    this.localPlayerId = localPlayerId;
    this.engine = new Engine(this.canvas, true, {
      powerPreference: "high-performance",
      doNotHandleContextLost: true,
      adaptToDeviceRatio: true,
      limitDeviceRatio: MAX_DEVICE_RATIO,
    });
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);
    this.scene.skipPointerMovePicking = true;

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 30, Vector3.Zero(), this.scene);
    this.camera.movement.input.setInteraction("pointer", { button: 0 }, "rotate");
    this.camera.movement.input.setInteraction("pointer", { button: 2 }, "rotate");
    this.camera.attachControl(false);
    this.camera.inertia = 0;
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
      if (!this.panButtons.left && !this.panButtons.right && document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
    };
    this.onLockChange = () => {
      const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
      if (document.pointerLockElement === this.canvas) {
        this.swallowNextLockedMove = true;
      } else {
        this.panButtons.left = false;
        this.panButtons.right = false;
        if (mouseInput) mouseInput.onLostFocus();
      }
    };
    this.canvas.addEventListener("pointerdown", this.onPanDown);
    document.addEventListener("pointerup", this.onPanUp);
    document.addEventListener("pointerlockchange", this.onLockChange);

    const pointers = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (pointers) {
      const baseOnTouch = pointers.onTouch.bind(pointers);
      pointers.onTouch = (point, offsetX, offsetY) => {
        if (this.swallowNextLockedMove) {
          this.swallowNextLockedMove = false;
          return;
        }
        baseOnTouch(point, offsetX, offsetY);
      };
    }

    const ambientLight = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
    ambientLight.specular = new Color3(0.15, 0.15, 0.15);
    ambientLight.groundColor = new Color3(0.12, 0.12, 0.16);

    const fillLight = new DirectionalLight("fillLight", new Vector3(-0.5, -1, -0.3), this.scene);
    fillLight.intensity = 0.45;
    fillLight.specular = new Color3(0.2, 0.2, 0.2);

    const renderKeys = getWorldRenderKeys(world) ?? computeWorldRenderKeys(world);
    this.buildArena(world.arena, renderKeys.arena);
    this.waymarks = this.own(new WaymarkLayer(this.scene));
    this.waymarks.sync(world.waymarks, renderKeys.waymarks);
    this.crystals = this.own(new CrystalLayer(this.scene));
    this.crystals.sync(world.crystals, world.time, renderKeys.crystals);

    this.players = this.own(new PlayerLayer(this.scene));
    this.players.init(world.players);
    this.healthBars = this.own(new HealthBarLayer(this.scene));
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
    this.rebuildBossLayers(world.bosses);
    this.telegraphs = this.own(new TelegraphLayer(this.scene));
    this.tethers = this.own(new TetherLayer(this.scene));
    this.lineLinks = this.own(new LineLinkLayer(this.scene));
    this.chains = this.own(new ChainLayer(this.scene));
    this.towers = this.own(new KeyedMeshLayer(this.scene, createTowerMeshes));
    this.stacks = this.own(new StackLayer(this.scene));
    this.inverse = this.own(new InverseLayer(this.scene));
    this.spreadStacks = this.own(new SpreadStackLayer(this.scene));
    this.gaze = this.own(new GazeLayer(this.scene));
    this.hands = this.own(new HandLayer(this.scene));
    this.forcedMarches = this.own(new KeyedMeshLayer(this.scene, createForcedMarchMeshes));
    this.hazards = this.own(new KeyedMeshLayer(this.scene, createHazardMeshes));
    this.divebombs = this.own(new KeyedMeshLayer(this.scene, createDivebombMeshes));
    this.elementGlyphs = this.own(new ElementGlyphLayer(this.scene));
    this.elementRings = this.own(new ElementRingLayer(this.scene));
    this.movers = this.own(new MoverLayer(this.scene));
    this.effectRings = this.own(new PlayerEffectRingLayer(this.scene));
    this.countdownPie = this.own(new CountdownPieLayer(this.scene));
    this.hud = new HudOverlay(
      sessionId,
      this.localPlayerId,
      this.onSettingsChange,
      id => this.setSpectateTarget(id),
      this.onDebugPosition,
      this.botsButton,
      this.hudLayout,
    );

    prewarmShaders(this.scene);

    this.onResize = () => this.applyRenderScale();
    window.addEventListener("resize", this.onResize);
  }

  private own<T extends { dispose(): void }>(layer: T): T {
    this.owned.push(layer);
    return layer;
  }

  private rebuildBossLayers(bosses: Boss[]): void {
    for (const id of this.bossIds) this.healthBars.remove(bossCastBarId(id));
    for (const layer of this.bossLayers.values()) layer.dispose();
    this.bossLayers.clear();
    for (const layer of this.bossRingLayers.values()) layer.dispose();
    this.bossRingLayers.clear();
    for (const layer of this.bossSideOrbLayers.values()) layer.dispose();
    this.bossSideOrbLayers.clear();
    for (const layer of this.targetRingLayers.values()) layer.dispose();
    this.targetRingLayers.clear();

    for (const boss of bosses) {
      const bossLayer = new BossLayer(this.scene);
      bossLayer.init(boss);
      this.bossLayers.set(boss.id, bossLayer);
      const mesh = bossLayer.getMesh();
      if (mesh) {
        this.healthBars.link(bossCastBarId(boss.id), mesh, {
          trackWidthPx: 200,
          trackHeightPx: 25,
          offsetYPx: -20,
          color: CAST_BAR_COLOR,
          showLabel: true,
          cornerRadiusPx: 8.75,
          borderColor: "#3a4256",
          backgroundColor: "#0b0e15",
          labelFontSizePx: 16.25,
        });
      }
      const bossRingLayer = new BossRingLayer(this.scene);
      bossRingLayer.sync(boss);
      this.bossRingLayers.set(boss.id, bossRingLayer);
      const targetRingLayer = new TargetRingLayer(this.scene);
      this.targetRingLayers.set(boss.id, targetRingLayer);
      this.bossSideOrbLayers.set(boss.id, new BossSideOrbLayer(this.scene));
    }
    this.bossIds = bosses.map(b => b.id);
    this.bossesKey = bossLayersKey(bosses);
  }

  private bossSetChanged(bosses: Boss[]): boolean {
    return bossLayersKey(bosses) !== this.bossesKey;
  }

  private buildArena(arena: Arena, key: string): void {
    for (const mesh of this.floorMeshes) mesh.dispose(false, true);
    this.floorMeshes = createArenaMeshes(this.scene, arena, ARENA_IMAGE_ROOT);
    this.arenaKey = key;
  }

  setPlaybackState(state: PlaybackState): void {
    this.hud.setPlaybackState(state);
  }

  sync(world: World): void {
    const renderKeys = getWorldRenderKeys(world) ?? computeWorldRenderKeys(world);
    if (renderKeys.arena !== this.arenaKey) this.buildArena(world.arena, renderKeys.arena);
    this.waymarks.sync(world.waymarks, renderKeys.waymarks);
    this.crystals.sync(world.crystals, world.time, renderKeys.crystals);

    if (this.bossSetChanged(world.bosses)) this.rebuildBossLayers(world.bosses);

    const botsInvisible = this.botsInvisibleOverride ?? world.botsInvisible;
    this.players.sync(world.players, world.time, botsInvisible, world);
    const povPlayer = resolvePovPlayer(world.players, this.localPlayerId, this.spectateTargetId);
    const sideOrbs = selectBossSideOrbs(world);
    const sealedImplement = selectSealedImplement(world.active);
    for (const boss of world.bosses) {
      this.bossLayers.get(boss.id)?.sync(boss, world.time, sealedImplement);
      this.bossRingLayers.get(boss.id)?.sync(boss);
      this.bossSideOrbLayers.get(boss.id)?.sync(boss, sideOrbs.get(boss.id), world.time);
      this.targetRingLayers.get(boss.id)?.sync(boss, povPlayer?.targetBossId === boss.id);
    }
    if (povPlayer?.alive) this.camera.target.set(povPlayer.pos.x, 0, povPlayer.pos.z);

    for (const player of world.players) {
      const hidden = !this.players.isVisible(player.id) || (botsInvisible && player.control === "bot");
      this.healthBars.set(playerBarId(player.id), player.hp / player.maxHp, player.alive && this.renderedPlayerHealthBars && !hidden);
    }
    const castCandidates = buildCastCandidates(world);
    for (const boss of world.bosses) {
      const cast = castForBoss(boss.id, castCandidates);
      const span = cast ? cast.resolveAt - cast.telegraphStart : 0;
      const progress = cast && span > 0 ? Math.min(1, Math.max(0, (world.time - cast.telegraphStart) / span)) : 0;
      this.healthBars.set(
        bossCastBarId(boss.id),
        progress,
        boss.hp > 0 && !boss.hidden && cast !== null,
        cast?.name,
        CAST_BAR_COLOR,
      );
    }

    this.telegraphs.sync(world.active, world.time);
    this.tethers.sync(world.tetherSources, world.players, world.time);
    this.lineLinks.sync(world.lineLinks, world.players, world.time);
    this.chains.sync(world.chains, world.players);
    this.towers.sync(world.towers, (handle, tower) => updateTowerMeshes(handle, tower, world.time));
    this.stacks.sync(world.groupMechanics, world.players, world.time);
    this.inverse.sync(world.inversions, world.boss, world.time);
    this.spreadStacks.sync(world.spreadStacks, world.boss, world.players, world.time);
    this.gaze.sync(world.gazes, world.time);
    this.hands.sync(world.active, world.bosses);
    this.forcedMarches.sync(world.forcedMarches, (handle, fm) => updateForcedMarchMeshes(handle, fm, world.time));
    this.hazards.sync(world.hazards, (handle, hazard) => updateHazardMeshes(handle, hazard, world.time));
    this.divebombs.sync(world.divebombs, (handle, divebomb) => updateDivebombMeshes(handle, divebomb, world.time));
    this.elementGlyphs.sync(world.active, world.time);
    this.elementRings.sync(world.active, world.time);
    this.movers.sync(world.active, world.time);
    this.effectRings.sync(world.players, world.time, player => player.id === povPlayer?.id);
    this.countdownPie.sync(povPlayer, world.time);
    this.hud.sync(world, povPlayer, renderKeys);
  }

  render(): void {
    this.scene.render();
    this.hud.setFps(this.engine.getFps(), performance.now());
  }

  applySettings(s: Settings): void {
    const sens = 2000 / (s.mouseSensitivity * 3);
    this.controllerSensitivity = s.controllerSensitivity;
    this.cameraAccel = s.cameraAccel;
    this.cameraAccelStrength = s.cameraAccelStrength;
    this.renderedPlayerHealthBars = s.renderedPlayerHealthBars;
    this.renderScale = s.renderScale;
    this.applyRenderScale();
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    const mouseInput = this.camera.inputs.attached.pointers as ArcRotateCameraPointersInput | undefined;
    if (mouseInput) mouseInput.buttons = [0, 2];
    setControlScheme(s.controlScheme);
    this.hud.applySettings(s);
  }

  private applyRenderScale(): void {
    this.engine.setHardwareScalingLevel(1 / (Math.min(window.devicePixelRatio || 1, MAX_DEVICE_RATIO) * this.renderScale));
    this.engine.resize();
  }

  setBotsInvisible(enabled: boolean): void {
    this.botsInvisibleOverride = enabled;
  }

  setSpectateTarget(id: string): void {
    this.spectateTargetId = id;
    this.hud.markSpectating(id);
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

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
    for (const layer of this.bossLayers.values()) layer.dispose();
    for (const bossRing of this.bossRingLayers.values()) bossRing.dispose();
    for (const sideOrbs of this.bossSideOrbLayers.values()) sideOrbs.dispose();
    for (const targetRing of this.targetRingLayers.values()) targetRing.dispose();
    for (const layer of this.owned.reverse()) layer.dispose();
    this.owned = [];
    this.engine.dispose();
  }
}
