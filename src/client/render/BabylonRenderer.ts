import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial, Mesh,
} from "@babylonjs/core";
import type { Renderer } from "./Renderer";
import type { World, ZoneShape, ActiveMechanic } from "../../shared/types";
import type { Vec2 } from "../../shared/math";
import { normalize } from "../../shared/math";
import type { Settings } from "../settings";

export class BabylonRenderer implements Renderer {
  private engine!: Engine;
  private scene!: Scene;
  private camera!: ArcRotateCamera;
  private playerMeshes = new Map<string, Mesh>();
  private telegraphMeshes = new Map<string, Mesh>();
  private hudEl!: HTMLDivElement;
  private onResize!: () => void;

  constructor(private canvas: HTMLCanvasElement) {}

  init(world: World): void {
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0.05, 0.05, 0.1, 1);

    this.camera = new ArcRotateCamera("cam", -Math.PI / 2, Math.PI / 3, 45, Vector3.Zero(), this.scene);
    this.camera.attachControl(this.canvas, true);
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 40;
    this.camera.upperBetaLimit = Math.PI / 2 - 0.05;
    this.canvas.addEventListener("contextmenu", e => e.preventDefault());

    new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);

    for (const zone of world.arena.zones) {
      this.createZoneMesh(zone);
    }

    for (const player of world.players) {
      const mesh = MeshBuilder.CreateCapsule(`player-${player.id}`, { radius: 0.5, height: 2 }, this.scene);
      const mat = new StandardMaterial(`pmat-${player.id}`, this.scene);
      mat.diffuseColor =
        player.role === "tank" ? new Color3(0.3, 0.5, 1) :
        player.role === "healer" ? new Color3(0.3, 1, 0.5) :
        new Color3(1, 0.4, 0.4);
      mesh.material = mat;
      mesh.position.set(player.pos.x, 1, player.pos.z);
      this.playerMeshes.set(player.id, mesh);
    }

    this.hudEl = document.createElement("div");
    Object.assign(this.hudEl.style, {
      position: "fixed", top: "12px", left: "12px",
      color: "white", fontFamily: "monospace", fontSize: "18px",
      pointerEvents: "none", whiteSpace: "pre",
      textShadow: "1px 1px 4px black",
    });
    document.body.appendChild(this.hudEl);

    this.engine.runRenderLoop(() => this.scene.render());
    this.onResize = () => this.engine.resize();
    window.addEventListener("resize", this.onResize);
  }

  private createZoneMesh(zone: ZoneShape): void {
    const mat = new StandardMaterial("floor-mat", this.scene);
    mat.diffuseColor = new Color3(0.2, 0.2, 0.25);

    let mesh: Mesh;
    switch (zone.kind) {
      case "circle":
        mesh = MeshBuilder.CreateDisc("floor", { radius: zone.radius, tessellation: 64 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(zone.center.x, 0, zone.center.z);
        break;
      case "rect":
        mesh = MeshBuilder.CreateGround("floor", { width: zone.width, height: zone.height }, this.scene);
        mesh.position.set(zone.center.x, 0, zone.center.z);
        break;
      case "polygon":
        console.warn("Polygon arena zones are not yet rendered");
        return;
    }
    mesh.material = mat;
  }

  sync(world: World, _alpha: number): void {
    for (const player of world.players) {
      const mesh = this.playerMeshes.get(player.id);
      if (!mesh) continue;
      mesh.position.x = player.pos.x;
      mesh.position.z = player.pos.z;
      mesh.isVisible = player.alive;
    }

    const alive = world.players.find(p => p.alive);
    if (alive) this.camera.target.set(alive.pos.x, 0, alive.pos.z);

    // Sync telegraph overlays
    const activeIds = new Set(world.active.map(m => m.id));
    for (const [id, mesh] of this.telegraphMeshes) {
      if (!activeIds.has(id)) {
        mesh.dispose();
        this.telegraphMeshes.delete(id);
      }
    }

    for (const mechanic of world.active) {
      if (!this.telegraphMeshes.has(mechanic.id)) {
        const mesh = this.createTelegraphMesh(mechanic);
        if (mesh) this.telegraphMeshes.set(mechanic.id, mesh);
      }
      const mesh = this.telegraphMeshes.get(mechanic.id);
      if (!mesh) continue;
      const mat = mesh.material as StandardMaterial;
      if (mechanic.resolved) {
        mat.diffuseColor = new Color3(1, 1, 1);
        mat.alpha = 0.8;
      } else {
        const span = mechanic.resolveAt - mechanic.telegraphStart;
        const progress = span > 0 ? (world.time - mechanic.telegraphStart) / span : 1;
        mat.diffuseColor = new Color3(1, Math.max(0, 0.8 - progress * 0.6), 0);
        mat.alpha = 0.25 + progress * 0.45;
      }
    }

    const p = world.players[0];
    if (world.status === "cleared") {
      this.hudEl.textContent = "CLEARED!";
      this.hudEl.style.color = "#7fff7f";
    } else if (world.status === "wiped") {
      this.hudEl.textContent = "WIPED";
      this.hudEl.style.color = "#ff6060";
    } else {
      this.hudEl.style.color = "white";
      this.hudEl.textContent = `Time: ${world.time.toFixed(1)}s   HP: ${p?.hp ?? 0}`;
    }
  }

  private createTelegraphMesh(mechanic: ActiveMechanic): Mesh | null {
    const shape = mechanic.shape;
    const Y = 0.01;
    let mesh: Mesh;

    switch (shape.kind) {
      case "circle":
        mesh = MeshBuilder.CreateDisc(`tel-${mechanic.id}`, { radius: shape.radius, tessellation: 64 }, this.scene);
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(shape.center.x, Y, shape.center.z);
        break;

      case "donut": {
        const seg = 64;
        const outer: Vector3[] = [], inner: Vector3[] = [];
        for (let i = 0; i <= seg; i++) {
          const a = (i / seg) * Math.PI * 2;
          const c = Math.cos(a), s = Math.sin(a);
          outer.push(new Vector3(shape.center.x + c * shape.outer, Y, shape.center.z + s * shape.outer));
          inner.push(new Vector3(shape.center.x + c * shape.inner, Y, shape.center.z + s * shape.inner));
        }
        mesh = MeshBuilder.CreateRibbon(`tel-${mechanic.id}`, { pathArray: [outer, inner] }, this.scene);
        break;
      }

      case "cone": {
        const dir = normalize(shape.direction);
        const yaw = Math.atan2(dir.x, dir.z);
        const half = (shape.angleDeg / 2) * (Math.PI / 180);
        const seg = 32;
        const apex = new Vector3(shape.origin.x, Y, shape.origin.z);
        const arc: Vector3[] = [];
        for (let i = 0; i <= seg; i++) {
          const a = yaw - half + (i / seg) * shape.angleDeg * (Math.PI / 180);
          arc.push(new Vector3(
            shape.origin.x + Math.sin(a) * shape.length, Y,
            shape.origin.z + Math.cos(a) * shape.length,
          ));
        }
        mesh = MeshBuilder.CreateRibbon(`tel-${mechanic.id}`, {
          pathArray: [Array(seg + 1).fill(apex), arc],
        }, this.scene);
        break;
      }

      case "rect": {
        const dir = normalize(shape.direction);
        const yaw = Math.atan2(dir.x, dir.z);
        mesh = MeshBuilder.CreateGround(`tel-${mechanic.id}`, { width: shape.width, height: shape.length }, this.scene);
        mesh.rotation.y = yaw;
        mesh.position.set(
          shape.origin.x + dir.x * shape.length / 2,
          Y,
          shape.origin.z + dir.z * shape.length / 2,
        );
        break;
      }

      default:
        return null;
    }

    const mat = new StandardMaterial(`tel-mat-${mechanic.id}`, this.scene);
    mat.backFaceCulling = false;
    mesh.material = mat;
    return mesh;
  }

  applySettings(s: Settings): void {
    const sens = 2000 / s.mouseSensitivity;
    this.camera.angularSensibilityX = sens;
    this.camera.angularSensibilityY = sens;
    const mouseInput = (this.camera.inputs.attached as any).mouse;
    if (mouseInput) mouseInput.buttons = s.panButton === "right" ? [2] : [0];
  }

  getCameraYaw(): number {
    const fwd = this.camera.target.subtract(this.camera.position);
    return Math.atan2(fwd.x, fwd.z);
  }

  dispose(): void {
    window.removeEventListener("resize", this.onResize);
    this.hudEl.remove();
    this.engine.dispose();
  }
}
