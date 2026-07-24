import { CAR_TYPES, WORLD, type Point, type RectShape, roadsX, roadsY } from "./config.ts";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

interface SmokePuff {
  angle: number;
  distance: number;
  size: number;
}
interface Debris {
  x: number;
  y: number;
  angle: number;
  color: string;
  size: number;
}
interface Explosion {
  x: number;
  y: number;
  age: number;
  duration: number;
  smoke: SmokePuff[];
  debris: Debris[];
}
interface PickupShape {
  x: number;
  y: number;
  kind: string;
}
interface PropShape {
  x: number;
  y: number;
  radius: number;
  color: string;
}
interface DeathShape {
  x: number;
  y: number;
  age: number;
  duration: number;
  angle: number;
  color: string;
}
interface EnemyShape {
  x: number;
  y: number;
  health: number;
  flash: { value: number };
}
interface RemoteStateShape {
  carAlive?: boolean;
  cx: number;
  cy: number;
  ca: number;
  mode: string;
  carType?: string;
  carHealth?: number;
  phase: string;
  px: number;
  py: number;
  pa: number;
  health: number;
}
interface RemoteShape {
  color: string;
  carFlash: { value: number };
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  buildings: RectShape[],
  cover: RectShape[],
) {
  ctx.fillStyle = "#1d2928";
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);
  ctx.fillStyle = "#263334";
  for (const x of roadsX) ctx.fillRect(x - 120, 0, 240, WORLD.h);
  for (const y of roadsY) ctx.fillRect(0, y - 120, WORLD.w, 240);
  ctx.strokeStyle = "#d3b955";
  ctx.lineWidth = 3;
  ctx.setLineDash([28, 24]);
  ctx.beginPath();
  for (const x of roadsX) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD.h);
  }
  for (const y of roadsY) {
    ctx.moveTo(0, y);
    ctx.lineTo(WORLD.w, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const r of buildings) {
    ctx.fillStyle = "#182124";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#405257";
    ctx.lineWidth = 5;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = "#29373b";
    for (let x = r.x + 22; x < r.x + r.w - 12; x += 42) ctx.fillRect(x, r.y + 18, 22, 10);
  }
  for (const r of cover) {
    ctx.fillStyle = "#755749";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = "#a47b5f";
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  }
  ctx.strokeStyle = "#4a5b5d";
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, WORLD.w - 8, WORLD.h - 8);
}

export function drawCarExplosion(ctx: CanvasRenderingContext2D, explosion: Explosion) {
  const t = explosion.age / explosion.duration;
  ctx.save();
  if (t < 0.42) {
    const shock = t / 0.42;
    ctx.globalAlpha = (1 - shock) * 0.75;
    ctx.strokeStyle = "#ffe59a";
    ctx.lineWidth = 6 * (1 - shock) + 1;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, 12 + shock * 105, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (t < 0.55) {
    const fire = t / 0.55;
    const radius = Math.sin(fire * Math.PI) * 58 + 12;
    const gradient = ctx.createRadialGradient(
      explosion.x,
      explosion.y,
      2,
      explosion.x,
      explosion.y,
      radius,
    );
    gradient.addColorStop(0, "rgba(255,255,215,0.98)");
    gradient.addColorStop(0.28, "rgba(255,204,74,0.95)");
    gradient.addColorStop(0.68, "rgba(255,82,35,0.82)");
    gradient.addColorStop(1, "rgba(92,25,16,0)");
    ctx.globalAlpha = 1 - fire * 0.35;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(explosion.x, explosion.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
  const smokeT = clamp((t - 0.12) / 0.88, 0, 1);
  for (const puff of explosion.smoke) {
    const distance = puff.distance * (0.4 + smokeT * 1.5);
    ctx.globalAlpha = smokeT * (1 - t) * 0.58;
    ctx.fillStyle = "#293032";
    ctx.beginPath();
    ctx.arc(
      explosion.x + Math.cos(puff.angle) * distance,
      explosion.y + Math.sin(puff.angle) * distance - smokeT * 22,
      puff.size * (0.55 + smokeT),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = clamp(1 - t, 0, 1);
  for (const debris of explosion.debris) {
    ctx.save();
    ctx.translate(debris.x, debris.y);
    ctx.rotate(debris.angle);
    ctx.fillStyle = debris.color;
    ctx.fillRect(-debris.size / 2, -debris.size / 3, debris.size, debris.size * 0.66);
    ctx.restore();
  }
  ctx.restore();
}

export function drawPickup(ctx: CanvasRenderingContext2D, pickup: PickupShape) {
  const pulse = 1 + Math.sin(performance.now() * 0.006 + pickup.x) * 0.12;
  const weapon = pickup.kind === "weapon";
  ctx.save();
  ctx.translate(pickup.x, pickup.y);
  ctx.scale(pulse, pulse);
  ctx.fillStyle = weapon ? "rgba(255,204,92,0.2)" : "rgba(70,255,155,0.18)";
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  if (weapon) {
    ctx.fillStyle = "#ffcb5c";
    ctx.fillRect(-16, -5, 28, 8);
    ctx.fillRect(7, 2, 8, 10);
    ctx.fillStyle = "#fff2b8";
    ctx.fillRect(-19, -3, 5, 4);
  } else {
    ctx.fillStyle = "#63efa5";
    ctx.fillRect(-5, -15, 10, 30);
    ctx.fillRect(-15, -5, 30, 10);
  }
  ctx.restore();
}

export function drawProp(ctx: CanvasRenderingContext2D, prop: PropShape) {
  ctx.fillStyle = "#101719";
  ctx.beginPath();
  ctx.arc(prop.x + 3, prop.y + 4, prop.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = prop.color;
  ctx.beginPath();
  ctx.arc(prop.x, prop.y, prop.radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(prop.x - prop.radius + 3, prop.y);
  ctx.lineTo(prop.x + prop.radius - 3, prop.y);
  ctx.stroke();
}

export function drawEnemyDeath(ctx: CanvasRenderingContext2D, death: DeathShape) {
  const t = death.age / death.duration;
  const fall = Math.min(1, t * 2.4);
  ctx.save();
  ctx.translate(death.x, death.y + fall * 10);
  ctx.rotate(death.angle + fall * 1.25);
  ctx.scale(1 + fall * 0.25, Math.max(0.16, 1 - fall * 0.82));
  ctx.globalAlpha = 1 - Math.max(0, (t - 0.55) / 0.45);
  ctx.fillStyle = "#1a2022";
  ctx.beginPath();
  ctx.arc(3, 4, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = death.color;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#ffb08a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, 0);
  ctx.lineTo(18 + t * 15, 0);
  ctx.stroke();
  ctx.restore();
}

export function drawEnemy(ctx: CanvasRenderingContext2D, enemy: EnemyShape, target: Point) {
  const angle = Math.atan2(target.y - enemy.y, target.x - enemy.x);
  drawPerson(ctx, enemy.x, enemy.y, angle, "#ef5f57", false, enemy.flash.value);
  ctx.fillStyle = "#101719";
  ctx.fillRect(enemy.x - 17, enemy.y - 27, 34, 4);
  ctx.fillStyle = "#ff8a75";
  ctx.fillRect(enemy.x - 17, enemy.y - 27, 34 * (enemy.health / 100), 4);
}

export function drawCar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  carColor: string,
  occupied: boolean,
  flash = 0,
  type = "compact",
) {
  const config = CAR_TYPES[type] ?? CAR_TYPES.compact;
  const hw = config.w / 2;
  const hh = config.h / 2;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = "#0b1012";
  ctx.fillRect(-hw + 5, -hh - 4, 12, 6);
  ctx.fillRect(hw - 17, -hh - 4, 12, 6);
  ctx.fillRect(-hw + 5, hh - 2, 12, 6);
  ctx.fillRect(hw - 17, hh - 2, 12, 6);
  ctx.fillStyle = carColor;
  ctx.fillRect(-hw, -hh, config.w, config.h);
  ctx.fillStyle = "#263b43";
  const cabinW = type === "muscle" ? 24 : type === "drift" ? 29 : 22;
  ctx.fillRect(-8, -hh + 3, cabinW, config.h - 6);
  if (type === "drift") {
    ctx.fillStyle = "#f2e8ff";
    ctx.fillRect(-hw + 5, -hh + 3, 13, 3);
    ctx.fillRect(-hw + 5, hh - 6, 13, 3);
  }
  ctx.fillStyle = occupied ? "#fff0a8" : "#9fb7bd";
  ctx.fillRect(hw - 6, -hh + 5, 5, 7);
  ctx.fillRect(hw - 6, hh - 12, 5, 7);
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.85;
    ctx.fillStyle = "#fff";
    ctx.fillRect(-hw, -hh, config.w, config.h);
  }
  ctx.restore();
}

export function drawPerson(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  personColor: string,
  local = false,
  flash = 0,
) {
  ctx.strokeStyle = "#172024";
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(angle) * 25, y + Math.sin(angle) * 25);
  ctx.stroke();
  ctx.fillStyle = personColor;
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fill();
  if (flash > 0) {
    ctx.globalAlpha = flash * 0.9;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (local) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

export function drawRemote(
  ctx: CanvasRenderingContext2D,
  state: RemoteStateShape,
  remote: RemoteShape,
) {
  if (state.carAlive !== false) {
    drawCar(
      ctx,
      state.cx,
      state.cy,
      state.ca,
      remote.color,
      state.mode === "car",
      remote.carFlash.value,
      state.carType,
    );
    ctx.fillStyle = "#11191b";
    ctx.fillRect(state.cx - 24, state.cy - 28, 48, 4);
    ctx.fillStyle = "#e7a75d";
    ctx.fillRect(state.cx - 24, state.cy - 28, 48 * ((state.carHealth ?? 100) / 100), 4);
  }
  if (state.phase === "alive" && state.mode === "foot") {
    drawPerson(ctx, state.px, state.py, state.pa, remote.color);
    ctx.fillStyle = "#11191b";
    ctx.fillRect(state.px - 18, state.py - 29, 36, 4);
    ctx.fillStyle = "#62dea3";
    ctx.fillRect(state.px - 18, state.py - 29, 36 * (state.health / 100), 4);
  }
}
