import { Mathf } from "minimotor";
import type { Component, Ecs } from "minimotor";
import type { UiApi } from "minimotor/ui";
import {
  CAR_TYPES,
  WEAPONS,
  WORLD,
  type PickupData,
  type RectShape,
  roadsX,
  roadsY,
} from "./config.ts";

interface CarLike {
  x: number;
  y: number;
  type: string;
  health: number;
}
interface EnemyLike {
  x: number;
  y: number;
  dead: number;
  health: number;
}
interface RemoteMinimapState {
  phase: string;
  px: number;
  py: number;
}
interface RemoteLike {
  color: string;
  sample(): RemoteMinimapState | null;
}
interface PlayerLike {
  x: number;
  y: number;
  inCar: boolean;
  health: number;
}
interface Camera {
  sx(n: number): number;
  sy(n: number): number;
}

export interface HudState {
  Pickup: Component<PickupData>;
  activeWeapon: number;
  buildings: RectShape[];
  camera: Camera;
  car: CarLike;
  cars: CarLike[];
  color: string;
  enemies: EnemyLike[];
  gameState: string;
  nearestEnterableCar: () => CarLike | null;
  ownedWeapons: Set<string>;
  pickupWorld: Ecs;
  player: PlayerLike;
  remotes: ReadonlyMap<string, RemoteLike>;
  selectWeapon: (slot: number) => void;
  vp: { w: number; h: number };
}

export function createRoadHud(UI: UiApi, getState: () => HudState) {
  function drawEnterCarPrompt() {
    const { camera, gameState, nearestEnterableCar, player, vp } = getState();
    const nearCar = nearestEnterableCar();
    if (gameState !== "alive" || player.inCar || !nearCar) return;
    const carScreenX = camera.sx(nearCar.x);
    const carScreenY = camera.sy(nearCar.y);
    const promptX = Mathf.clamp(carScreenX - 56, 8, vp.w - 120);
    const promptY = Mathf.clamp(carScreenY - 56, 8, vp.h - 38);
    UI.panel(
      {
        x: promptX,
        y: promptY,
        w: 112,
        h: 30,
        bg: "rgba(10,16,18,0.94)",
        border: "#ffe071",
      },
      () => {
        UI.text(`E  ${CAR_TYPES[nearCar.type].label}`, {
          x: promptX,
          y: promptY,
          w: 112,
          h: 30,
          align: "center",
          size: 11,
          bold: true,
          color: "#ffe071",
        });
      },
    );
  }

  function drawPlayerHealth() {
    const { player, vp } = getState();
    const w = 306;
    const x = vp.w / 2 - w / 2;
    const y = vp.h - (player.inCar ? 142 : 113);
    UI.panel({ x, y, w, h: 25, bg: "rgba(10,16,18,0.9)", border: "#405257" }, () => {
      UI.text(`YOU  ${Math.ceil(player.health)}`, {
        x: x + 8,
        y,
        w: 62,
        h: 25,
        size: 9,
        bold: true,
        color: player.health > 30 ? "#8ff4dd" : "#ff796f",
      });
      UI.bar({
        x: x + 72,
        y: y + 7,
        w: w - 82,
        h: 11,
        value: player.health / 100,
        bg: "#182326",
        fill: player.health > 55 ? "#62dea3" : player.health > 25 ? "#ffc85c" : "#ff665f",
      });
    });
  }

  function drawCarHealth() {
    const { car, vp } = getState();
    const w = 306;
    const x = vp.w / 2 - w / 2;
    const y = vp.h - 113;
    UI.panel({ x, y, w, h: 25, bg: "rgba(10,16,18,0.9)", border: "#405257" }, () => {
      UI.text(`${CAR_TYPES[car.type].label}  ${Math.ceil(car.health)}`, {
        x: x + 8,
        y,
        w: 92,
        h: 25,
        size: 9,
        bold: true,
        color: car.health > 30 ? "#8ff4dd" : "#ff796f",
      });
      UI.bar({
        x: x + 102,
        y: y + 7,
        w: w - 112,
        h: 11,
        value: car.health / 100,
        bg: "#182326",
        fill: car.health > 55 ? "#52d7b8" : car.health > 25 ? "#ffc85c" : "#ff665f",
      });
    });
  }

  function drawInventory() {
    const { activeWeapon, ownedWeapons, selectWeapon, vp } = getState();
    const slotW = 98;
    const gap = 4;
    const totalW = WEAPONS.length * slotW + (WEAPONS.length - 1) * gap;
    const x = vp.w / 2 - totalW / 2;
    const y = vp.h - 84;
    for (let slot = 0; slot < WEAPONS.length; slot++) {
      const weapon = WEAPONS[slot];
      const unlocked = ownedWeapons.has(weapon.id);
      const row = { x: x + slot * (slotW + gap), y, w: slotW, h: 38 };
      if (
        UI.listItem({
          ...row,
          id: `road-rivals:weapon:${weapon.id}`,
          selected: slot === activeWeapon,
          disabled: !unlocked,
        })
      ) {
        selectWeapon(slot);
      }
      UI.text(`${slot + 1}  ${weapon.label}`, {
        ...row,
        y: row.y + 3,
        h: 17,
        align: "center",
        size: 9,
        bold: true,
        color: unlocked ? (slot === activeWeapon ? "#fff2a8" : "#dce7e7") : "dim",
      });
      UI.text(unlocked ? (slot === activeWeapon ? "EQUIPPED" : "READY") : "FIND PICKUP", {
        ...row,
        y: row.y + 19,
        h: 14,
        align: "center",
        size: 8,
        color: unlocked ? "#73e6c4" : "dim",
      });
    }
  }

  function drawMinimap(ctx: CanvasRenderingContext2D) {
    const {
      Pickup,
      buildings,
      car,
      cars,
      color,
      enemies,
      gameState,
      pickupWorld,
      player,
      remotes,
      vp,
    } = getState();
    const outer = { x: vp.w - 180, y: vp.h - 126, w: 170, h: 116 };
    const map = { x: outer.x + 8, y: outer.y + 22, w: 154, h: 86 };
    UI.panel({ ...outer, title: "CITY MAP" }, () => {
      ctx.save();
      ctx.beginPath();
      ctx.rect(map.x, map.y, map.w, map.h);
      ctx.clip();
      ctx.fillStyle = "#121c1d";
      ctx.fillRect(map.x, map.y, map.w, map.h);
      const mx = (x: number) => map.x + (x / WORLD.w) * map.w;
      const my = (y: number) => map.y + (y / WORLD.h) * map.h;
      ctx.strokeStyle = "#405052";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const x of roadsX) {
        ctx.moveTo(mx(x), map.y);
        ctx.lineTo(mx(x), map.y + map.h);
      }
      for (const y of roadsY) {
        ctx.moveTo(map.x, my(y));
        ctx.lineTo(map.x + map.w, my(y));
      }
      ctx.stroke();
      ctx.fillStyle = "#263235";
      for (const rect of buildings) {
        ctx.fillRect(
          mx(rect.x),
          my(rect.y),
          (rect.w / WORLD.w) * map.w,
          (rect.h / WORLD.h) * map.h,
        );
      }
      for (const pickup of pickupWorld.dense(Pickup)) {
        const x = mx(pickup.x);
        const y = my(pickup.y);
        if (pickup.kind === "weapon") {
          ctx.fillStyle = "#ffcb5c";
          ctx.beginPath();
          ctx.moveTo(x, y - 3.5);
          ctx.lineTo(x + 3.5, y);
          ctx.lineTo(x, y + 3.5);
          ctx.lineTo(x - 3.5, y);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "#fff2b8";
          ctx.lineWidth = 1;
          ctx.stroke();
        } else {
          ctx.fillStyle = "#55d88f";
          ctx.fillRect(x - 1.5, y - 4, 3, 8);
          ctx.fillRect(x - 4, y - 1.5, 8, 3);
        }
      }
      ctx.fillStyle = "#ff6f67";
      for (const enemy of enemies) {
        if (enemy.dead <= 0) ctx.fillRect(mx(enemy.x) - 1.5, my(enemy.y) - 1.5, 3, 3);
      }
      for (const fleetCar of cars) {
        if (fleetCar.health <= 0) continue;
        ctx.fillStyle = CAR_TYPES[fleetCar.type].color;
        ctx.fillRect(mx(fleetCar.x) - 1.5, my(fleetCar.y) - 1, 3, 2);
      }
      for (const remote of remotes.values()) {
        const state = remote.sample();
        if (!state || state.phase !== "alive") continue;
        ctx.fillStyle = remote.color;
        ctx.fillRect(mx(state.px) - 2, my(state.py) - 2, 4, 4);
      }
      if (gameState === "alive") {
        const local = player.inCar ? car : player;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(mx(local.x), my(local.y), 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    });
  }

  return {
    drawCarHealth,
    drawEnterCarPrompt,
    drawInventory,
    drawMinimap,
    drawPlayerHealth,
  };
}
