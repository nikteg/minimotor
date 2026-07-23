// Road Rivals — top-down shooter + enterable car + WebSocket multiplayer.
// Local movement/vehicle simulation is authoritative. Remote actors are drawn
// 100 ms in the past from Net.createInterpolator snapshot buffers.
import {
  Camera,
  Collision,
  Draw,
  ECS,
  Gizmos,
  Input,
  Keys,
  Loop,
  Mathf,
  Mouse,
  Net,
  OnscreenInput,
  Perf,
  Stage,
  Transitions,
  UI,
} from "minimotor";
import type { Entity, Flash, Interpolator, Transition, TransitionRun } from "minimotor";
import { Physics2D } from "minimotor/physics2d";
import type { Body2D } from "minimotor/physics2d";
import {
  CAR_TYPES,
  WEAPONS,
  WORLD,
  fleetPoints,
  roadsX,
  roadsY,
  type CarTypeId,
  type PickupData,
} from "./config.ts";
import { createRoadAudio } from "./audio.ts";
import { createRoadHud } from "./hud.ts";
import { createRoadWorld } from "./world.ts";
import {
  drawCar,
  drawCarExplosion,
  drawEnemy,
  drawEnemyDeath,
  drawPerson,
  drawPickup,
  drawProp,
  drawRemote,
  drawWorld,
} from "./visuals.ts";

interface Player {
  x: number;
  y: number;
  angle: number;
  inCar: boolean;
  health: number;
  knockX: number;
  knockY: number;
}
interface FleetCar {
  id: string;
  spawnX: number;
  spawnY: number;
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  steer: number;
  health: number;
  respawn: number;
  type: CarTypeId;
  flash: Flash;
  body: Body2D;
  lastImpactAt?: number;
}
interface BotState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  dead?: boolean;
}
interface Bot {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  health: number;
  dead: number;
  flash: Flash;
  interp: Interpolator<BotState>;
  ramCooldown?: number;
}
interface RemoteState {
  id?: string;
  color?: string;
  life?: number;
  phase: string;
  mode: string;
  px: number;
  py: number;
  pa: number;
  vx: number;
  vy: number;
  cx: number;
  cy: number;
  ca: number;
  health: number;
  carHealth?: number;
  carAlive?: boolean;
  carType?: string;
}
interface Remote {
  color: string;
  carFlash: Flash;
  lastSeen: number;
  life: number;
  interp: Interpolator<RemoteState>;
  // Previous interpolated car pose, used to derive skid marks locally (no
  // extra netcode). Null when the remote isn't in a live car, so a respawn or
  // teleport can't sweep a streak across the map.
  prevCar: { x: number; y: number; a: number } | null;
  tireMarkTimer: number;
}
interface Bullet {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  owner: string;
  color: string | undefined;
  life: number;
  damage: number;
  local: boolean;
  hostile: boolean;
  shotId: string | null;
}
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  spin: number;
  angle: number;
  size: number;
  color: string;
}
interface Smoke {
  angle: number;
  distance: number;
  size: number;
}
interface Explosion {
  x: number;
  y: number;
  age: number;
  duration: number;
  debris: Debris[];
  smoke: Smoke[];
}
interface EnemyDeath {
  x: number;
  y: number;
  angle: number;
  age: number;
  duration: number;
  color: string;
}
interface Wheel {
  x: number;
  y: number;
}
interface TireMark {
  x: number;
  y: number;
  x2: number;
  y2: number;
  life: number;
  alpha: number;
}
interface BodyData {
  kind?: string;
  car?: FleetCar;
  prop?: unknown;
}
interface BulletOptions {
  damage?: number;
  speed?: number;
  life?: number;
}
interface NetMsg {
  game?: string;
  id?: string;
  type?: string;
  bots?: BotState[];
  pickups?: PickupData[];
  target?: string;
  amount?: number;
  weapon?: string;
  by?: string;
  botId?: string;
  x?: number;
  y?: number;
  a?: number;
  color?: string;
  shotId?: string;
  bot?: boolean;
  damage?: number;
  speed?: number;
  life?: number;
  sound?: boolean;
  part?: string;
  ix?: number;
  iy?: number;
  phase?: string;
  mode?: string;
  px?: number;
  py?: number;
  pa?: number;
  vx?: number;
  vy?: number;
  cx?: number;
  cy?: number;
  ca?: number;
  health?: number;
  carHealth?: number;
  carAlive?: boolean;
  carId?: string;
  carType?: string;
}
interface RosterRow {
  label: string;
  status: string;
  color: string;
  local?: boolean;
}

const meter = Perf.createNetMeter();
// The viewport is LIVE (mutated on resize); the engine clears to `background`.
const vp = Stage.init("game", {
  background: "#101719",
  plugins: [Perf.plugin({ net: meter })],
});

// On-screen touch gamepad: left stick steers, GAS/BRAKE buttons. Autohide keeps
// it hidden on desktop and shown on touch (default), so keyboard is unaffected.
const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  stick: { anchor: { side: "left", x: 92, y: 92 }, radius: 62 },
  buttons: [
    { anchor: { side: "right", x: 78, y: 82 }, r: 40, button: "a", label: "GAS" },
    { anchor: { side: "right", x: 168, y: 132 }, r: 34, button: "b", label: "BRAKE" },
  ],
});

const clientNo = Number(new URLSearchParams(location.search).get("client") || 1);
const id = `${clientNo}-${Math.random().toString(36).slice(2, 7)}`;
const COLORS = ["#52e0c4", "#ffcb5c", "#ff6b72", "#8da1ff", "#d18cff"];
const color = COLORS[(clientNo - 1) % COLORS.length];
const spawn =
  clientNo % 2
    ? { x: roadsX[0], y: roadsY[0] }
    : { x: roadsX[roadsX.length - 1], y: roadsY[roadsY.length - 1] };

const playerFlash = Gizmos.flash(150);
const player: Player = {
  x: spawn.x,
  y: spawn.y,
  angle: 0,
  inCar: false,
  health: 100,
  knockX: 0,
  knockY: 0,
};
const ENTER_CAR_RANGE = 125;
const cars: FleetCar[] = fleetPoints(clientNo).map((point, index) => ({
  id: `${clientNo}:car:${index}`,
  spawnX: point.x,
  spawnY: point.y,
  x: point.x,
  y: point.y,
  angle: clientNo % 2 ? 0 : Math.PI,
  vx: 0,
  vy: 0,
  steer: 0,
  health: 100,
  respawn: 0,
  type: point.type,
  flash: Gizmos.flash(180),
  body: null as unknown as Body2D,
}));
let car = cars[0];
let carBody: Body2D = null as unknown as Body2D;
// The game lerps `cameraFocus` itself (mouse-look offset + spectator target),
// so the default camera follows it rigidly; the world clamp comes for free.
const cameraFocus = { x: spawn.x, y: spawn.y };
Camera.follow(cameraFocus, { world: WORLD, damping: 1 });
Camera.snap();

// Adapter over the default Camera facade: the old bespoke camera object exposed
// world↔screen helpers and an immediate snapTo. Shake now folds into
// `Camera.render`, so it is not part of these transforms.
const camera = {
  get x() {
    return Camera.x;
  },
  get y() {
    return Camera.y;
  },
  sx: (wx: number) => wx - Camera.x,
  sy: (wy: number) => wy - Camera.y,
  wx: (sx: number) => sx + Camera.x,
  wy: (sy: number) => sy + Camera.y,
  snapTo: (x: number, y: number) => {
    cameraFocus.x = x;
    cameraFocus.y = y;
    Camera.snap();
  },
};

const bullets: Bullet[] = [];
const sparks: Spark[] = [];
const explosions: Explosion[] = [];
const enemyDeaths: EnemyDeath[] = [];
const tireMarks: TireMark[] = [];
let previousRearWheels: [Wheel, Wheel] | null = null;
let tireMarkTimer = 0;
const remotes = new Map<string, Remote>();
let score = 0;
let life = 0;
let spawnProtectedUntil = 0;
const ownedWeapons = new Set<string>(["pistol"]);
let activeWeapon = 0;
let gameState = "spectator";
let transition: TransitionRun | null = null;
const actorCollisionCooldown = new Map<string, number>();

const { buildings, cover, intersections: botSpawns, props, solids } = createRoadWorld();
const enemies: Bot[] = [];
const botById = new Map<string, Bot>();
const Pickup = ECS.component<PickupData>("RoadRivalsPickup");
const pickupWorld = ECS.create();
const pickupEntities = new Map<string, Entity>();

// Box2D/Planck owns rigid collision and impulse transfer. The driving model
// below supplies tire-space velocities; the solver handles contacts, sliding,
// restitution, mass differences and movable-object reactions.
const physics = Physics2D.world({ gravity: { x: 0, y: 0 }, pixelsPerMeter: 50 });
physics.walls(0, 0, WORLD.w, WORLD.h, { thickness: 80, restitution: 0.16 });
for (const rect of solids) {
  physics.box(rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w, rect.h, {
    type: "static",
    friction: 0.6,
    restitution: 0.08,
    data: { kind: "scenery" },
  });
}
for (const fleetCar of cars) {
  const config = CAR_TYPES[fleetCar.type];
  fleetCar.body = physics.box(fleetCar.x, fleetCar.y, config.w, config.h, {
    density: config.mass,
    friction: 0.25,
    restitution: 0.18,
    linearDamping: 0.2,
    angularDamping: 1.5,
    bullet: true,
    data: { kind: "car", car: fleetCar },
  });
  fleetCar.body.rot = fleetCar.angle;
}
carBody = car.body;
for (const prop of props) {
  prop.body = physics.circle(prop.x, prop.y, prop.radius, {
    density: prop.mass,
    friction: 0.55,
    restitution: 0.28,
    linearDamping: 2.8,
    angularDamping: 2,
    data: { kind: "prop", prop },
  });
}

let engineLoad = 0;
let tireSlip = 0;
const {
  carExplosionSound,
  crashSound,
  damageSound,
  doorSound,
  enemyDeathSound,
  gunSound,
  joinSound,
  pickupSound,
  radioSound,
  unlockRoadAudio,
  updateEngineSound,
} = createRoadAudio(() => ({ player, car, gameState }));
addEventListener("keydown", unlockRoadAudio, { once: true });
addEventListener("pointerdown", unlockRoadAudio, { once: true });

let lastCrashAt = 0;
physics.onContact((a, b) => {
  const aData = a.data as BodyData;
  const bData = b.data as BodyData;
  const hitCar = aData?.kind === "car" ? a : bData?.kind === "car" ? b : null;
  if (!hitCar) return;
  const fleetCar = (hitCar.data as BodyData).car;
  const speed = Math.hypot(hitCar.vx, hitCar.vy);
  const now = performance.now();
  if (speed > 95 && now - lastCrashAt > 160) {
    lastCrashAt = now;
    crashSound(speed);
    Camera.shake(Math.min(12, speed / 45), 220);
  }
  if (fleetCar && speed > 125 && now - (fleetCar.lastImpactAt ?? 0) > 420) {
    fleetCar.lastImpactAt = now;
    damageCar(Math.min(12, 1 + (speed - 125) * 0.025), fleetCar);
  }
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const transport = Net.connect({
  url: location.origin.replace(/^http/, "ws") + "/ws-road-rivals",
  reconnectMs: 1000,
  heartbeatMs: 5000,
  idleTimeoutMs: 15000,
});

function angleDelta(a: number, b: number) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}
function blendState(a: RemoteState, b: RemoteState, t: number): RemoteState {
  return {
    ...b,
    px: Mathf.lerp(a.px, b.px, t),
    py: Mathf.lerp(a.py, b.py, t),
    pa: a.pa + angleDelta(a.pa, b.pa) * t,
    cx: Mathf.lerp(a.cx, b.cx, t),
    cy: Mathf.lerp(a.cy, b.cy, t),
    ca: a.ca + angleDelta(a.ca, b.ca) * t,
    health: Mathf.lerp(a.health, b.health, t),
  };
}

transport.onMessage = (bytes) => {
  if (!bytes.length) return;
  meter.recv(bytes.length);
  let msg: NetMsg;
  try {
    msg = JSON.parse(decoder.decode(bytes)) as NetMsg;
  } catch {
    return;
  }
  if (msg.game !== "road-rivals" || msg.id === id) return;
  if (msg.type === "world") {
    const liveBots = new Set<string>();
    for (const state of msg.bots ?? []) {
      liveBots.add(state.id);
      let bot = botById.get(state.id);
      if (!bot) {
        bot = {
          id: state.id,
          x: state.x,
          y: state.y,
          vx: 0,
          vy: 0,
          health: state.health,
          dead: state.dead ? 1 : 0,
          flash: Gizmos.flash(130),
          interp: Net.createInterpolator<BotState>({ delayMs: 100 }),
        };
        botById.set(state.id, bot);
        enemies.push(bot);
      }
      if (bot.dead && !state.dead) bot.interp.clear();
      bot.dead = state.dead ? 1 : 0;
      bot.health = state.health;
      bot.interp.push(state);
    }
    const activePickups = new Set((msg.pickups ?? []).map((pickup) => pickup.id));
    for (const pickup of msg.pickups ?? []) {
      const entity = pickupEntities.get(pickup.id);
      if (entity) Object.assign(pickupWorld.get(entity, Pickup)!, pickup);
      else {
        pickupEntities.set(pickup.id, pickupWorld.spawn(Pickup.with({ ...pickup })));
      }
    }
    for (const [pickupId, entity] of pickupEntities) {
      if (!activePickups.has(pickupId)) {
        pickupWorld.despawn(entity);
        pickupEntities.delete(pickupId);
      }
    }
    return;
  }
  if (msg.type === "heal") {
    if (msg.target === id && gameState === "alive") {
      player.health = Math.min(100, player.health + (msg.amount ?? 35));
      playerFlash.hit();
      pickupSound();
    }
    return;
  }
  if (msg.type === "weapon-pickup") {
    if (msg.target === id && msg.weapon) {
      ownedWeapons.add(msg.weapon);
      const slot = WEAPONS.findIndex((weapon) => weapon.id === msg.weapon);
      if (slot >= 0) activeWeapon = slot;
      pickupSound();
    }
    return;
  }
  if (msg.type === "bot-killed") {
    if (msg.by === id) {
      score += 100;
      radioSound();
    }
    const bot = botById.get(msg.botId ?? "");
    if (bot) {
      burst(bot.x, bot.y, "#ff695f", 24);
      enemyDeaths.push({
        x: bot.x,
        y: bot.y,
        angle: Math.atan2(bot.vy, bot.vx),
        age: 0,
        duration: 0.85,
        color: "#ef5f57",
      });
      enemyDeathSound(bot.x, bot.y);
    }
    return;
  }
  if (msg.type === "bye") return void remotes.delete(msg.id ?? "");
  if (msg.type === "car-explosion") {
    spawnCarExplosion(msg.x ?? 0, msg.y ?? 0, msg.color ?? "#ffcb5c");
    return;
  }
  if (msg.type === "shot") {
    spawnBullet(
      msg.x ?? 0,
      msg.y ?? 0,
      msg.a ?? 0,
      msg.id ?? "",
      msg.color,
      false,
      msg.shotId ?? null,
      !!msg.bot,
      {
        damage: msg.damage,
        speed: msg.speed,
        life: msg.life,
      },
    );
    if (msg.sound !== false) gunSound(msg.x ?? 0, msg.y ?? 0, msg.weapon);
    return;
  }
  if (msg.type === "hit") {
    // Everyone removes the matching visual projectile; only the named victim
    // applies damage. The shooter performs collision against interpolated
    // hitboxes, so feedback is immediate instead of passing through locally.
    const hitIndex = bullets.findIndex((bullet) => bullet.shotId === msg.shotId);
    if (hitIndex >= 0) bullets.splice(hitIndex, 1);
    if (msg.target === id) {
      if (msg.part === "car") {
        damageCar(msg.damage ?? 25);
        if (msg.ix || msg.iy) carBody.applyImpulse(msg.ix ?? 0, msg.iy ?? 0);
      } else {
        damagePlayer(msg.damage ?? 25);
        player.knockX += msg.ix ?? 0;
        player.knockY += msg.iy ?? 0;
      }
    }
    return;
  }
  if (msg.type !== "state") return;
  let remote = remotes.get(msg.id ?? "");
  if (!remote) {
    remote = {
      color: msg.color ?? "#fff",
      carFlash: Gizmos.flash(180),
      lastSeen: performance.now(),
      life: msg.life ?? 0,
      interp: Net.createInterpolator<RemoteState>({ delayMs: 100, lerp: blendState }),
      prevCar: null,
      tireMarkTimer: 0,
    };
    remotes.set(msg.id ?? "", remote);
  }
  remote.lastSeen = performance.now();
  if (remote.life !== msg.life) {
    remote.life = msg.life ?? 0;
    remote.interp.clear(); // respawns/teleports must snap, never sweep
    remote.prevCar = null; // ...and must not draw a skid across the teleport
  }
  remote.interp.push(msg as unknown as RemoteState);
};

addEventListener("pagehide", () => {
  transport.trySend(encoder.encode(JSON.stringify({ game: "road-rivals", type: "bye", id })));
});

function send(message: Record<string, unknown>) {
  const payload = JSON.stringify({ game: "road-rivals", id, color, ...message });
  if (transport.trySend(encoder.encode(payload))) meter.sent(payload.length);
}

const joinTransition: Transition = {
  durationMs: 720,
  render(ctx, t, viewport) {
    const eased = t * t * (3 - 2 * t);
    const half = (viewport.h / 2) * eased;
    ctx.save();
    ctx.fillStyle = "#071416";
    ctx.fillRect(0, 0, viewport.w, half);
    ctx.fillRect(0, viewport.h - half, viewport.w, half);
    ctx.strokeStyle = "#65ebd0";
    ctx.lineWidth = 3;
    ctx.globalAlpha = Math.min(1, eased * 2);
    ctx.beginPath();
    ctx.moveTo(0, half);
    ctx.lineTo(viewport.w, half);
    ctx.moveTo(0, viewport.h - half);
    ctx.lineTo(viewport.w, viewport.h - half);
    ctx.stroke();
    ctx.restore();
  },
};

function goToState(next: string, spec: Transition = Transitions.fade(420, "#071012")) {
  if (transition || gameState === next) return;
  gameState = "transition";
  transition = Transitions.run(spec, () => {
    gameState = next;
    if (next === "alive") resetPlayer();
  });
}

function moveCircle(body: { x: number; y: number }, dx: number, dy: number, radius: number) {
  const oldX = body.x;
  body.x = Mathf.clamp(oldX + dx, radius, WORLD.w - radius);
  if (solids.some((rect) => Collision.circleRect(body.x, body.y, radius, rect))) body.x = oldX;

  const oldY = body.y;
  body.y = Mathf.clamp(oldY + dy, radius, WORLD.h - radius);
  if (solids.some((rect) => Collision.circleRect(body.x, body.y, radius, rect))) body.y = oldY;
}

function carHits(x: number, y: number) {
  return (
    x < 28 ||
    y < 28 ||
    x > WORLD.w - 28 ||
    y > WORLD.h - 28 ||
    solids.some((r) => Collision.circleRect(x, y, 28, r)) ||
    cars.some(
      (candidate) =>
        candidate !== car &&
        candidate.health > 0 &&
        Collision.circleHit(x, y, 13, candidate.x, candidate.y, 29),
    )
  );
}

// A compact dynamic bicycle model: engine/brake forces act longitudinally,
// tires dissipate lateral slip, steering produces wheelbase-based yaw, and
// rolling + aerodynamic drag limit speed without an arbitrary hard clamp.
function updateCar(dt: number) {
  const config = CAR_TYPES[car.type];
  const throttle = Math.max(
    -1,
    Math.min(
      1,
      (Keys.down("KeyW") || Keys.down("ArrowUp") ? 1 : 0) -
        (Keys.down("KeyS") || Keys.down("ArrowDown") ? 1 : 0) +
        (pad.down(Input.Buttons.A) ? 1 : 0),
    ),
  );
  const steerInput = Math.max(
    -1,
    Math.min(
      1,
      (Keys.down("KeyD") || Keys.down("ArrowRight") ? 1 : 0) -
        (Keys.down("KeyA") || Keys.down("ArrowLeft") ? 1 : 0) +
        pad.axis(0),
    ),
  );
  car.angle = carBody.rot;
  car.vx = carBody.vx;
  car.vy = carBody.vy;
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  let forward = car.vx * c + car.vy * s;
  let lateral = -car.vx * s + car.vy * c;

  if (throttle > 0) forward += config.acceleration * dt;
  else if (throttle < 0) forward += (forward > 35 ? -1250 : -config.acceleration * 0.56) * dt;
  const drag = 0.72 + Math.abs(forward) * 0.00155;
  forward *= Math.exp(-drag * dt);
  const handbrake = Keys.down("Space") || pad.down(Input.Buttons.B);
  engineLoad = Math.abs(throttle);
  // Handbrake: lock the rear wheels. They scrub off forward speed and lose grip
  // so the tail slides; the `yawGain` boost below lets steering kick the car
  // into a drift instead of just washing sideways.
  if (handbrake) forward *= Math.exp(-1.8 * dt);
  const grip = handbrake ? 0.6 : config.grip;
  tireSlip = Math.abs(lateral) + (handbrake ? Math.abs(forward) * 0.5 + 24 : 0);
  lateral *= Math.exp(-grip * dt);
  // Power and steering can break rear traction, producing controllable fishtail
  // rather than random noise.
  if (throttle > 0 && Math.abs(forward) > 230)
    lateral -= steerInput * Math.abs(forward) * 0.62 * dt;

  const steerLimit = config.steer / (1 + Math.abs(forward) / 700);
  const targetSteer = steerInput * steerLimit;
  car.steer += (targetSteer - car.steer) * Math.min(1, dt * 12);

  const nc = Math.cos(car.angle);
  const ns = Math.sin(car.angle);
  carBody.vx = nc * forward - ns * lateral;
  carBody.vy = ns * forward + nc * lateral;
  // With the handbrake, steering yanks the tail around ~2× harder — the car
  // rotates faster than it travels, which (with the low grip above) is a drift.
  const yawGain = handbrake && Math.abs(forward) > 40 ? 2.2 : 1;
  carBody.spin = Math.abs(forward) > 4 ? (forward / 60) * Math.tan(car.steer) * yawGain : 0;
}

function nearestEnterableCar(): FleetCar | null {
  let nearest: FleetCar | null = null;
  let nearestDistance = ENTER_CAR_RANGE;
  for (const candidate of cars) {
    if (candidate.health <= 0) continue;
    const distance = Math.hypot(player.x - candidate.x, player.y - candidate.y);
    if (distance <= nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function tryToggleCar() {
  if (player.inCar) {
    const side = car.angle + Math.PI / 2;
    const candidates = [1, -1].map((sign) => ({
      x: car.x + Math.cos(side) * 48 * sign,
      y: car.y + Math.sin(side) * 48 * sign,
    }));
    const exit = candidates.find((p) => !carHits(p.x, p.y));
    if (exit) {
      player.inCar = false;
      player.x = exit.x;
      player.y = exit.y;
      doorSound(false);
    }
  } else {
    const nearby = nearestEnterableCar();
    if (nearby) {
      car = nearby;
      carBody = nearby.body;
      player.inCar = true;
      player.x = car.x;
      player.y = car.y;
      doorSound(true);
    }
  }
}

function spawnBullet(
  x: number,
  y: number,
  angle: number,
  owner: string,
  bulletColor: string | undefined,
  local: boolean,
  shotId: string | null = null,
  hostile = false,
  options: BulletOptions = {},
) {
  const speed = options.speed ?? 760;
  const muzzleX = x + Math.cos(angle) * 24;
  const muzzleY = y + Math.sin(angle) * 24;
  bullets.push({
    x: muzzleX,
    y: muzzleY,
    px: muzzleX,
    py: muzzleY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    owner,
    color: bulletColor,
    life: options.life ?? 1.25,
    damage: options.damage ?? (hostile ? 20 : 25),
    local,
    hostile,
    shotId,
  });
}

let shotCooldown = 0;
function cursorAimAngle(origin: { x: number; y: number } = player) {
  const screenX = origin.x - camera.x;
  const screenY = origin.y - camera.y;
  return Math.atan2(Mouse.y - screenY, Mouse.x - screenX);
}

function shoot() {
  const origin = player.inCar ? car : player;
  const aim = cursorAimAngle(origin);
  const weapon = WEAPONS[activeWeapon];
  player.angle = aim;
  const shotBase = `${id}:${performance.now().toFixed(1)}`;
  for (let i = 0; i < weapon.pellets; i++) {
    const angle = aim + Mathf.randRange(-weapon.spread, weapon.spread);
    const shotId = `${shotBase}:${i}`;
    const options = { damage: weapon.damage, speed: weapon.speed, life: weapon.life };
    spawnBullet(origin.x, origin.y, angle, id, color, true, shotId, false, options);
    send({
      type: "shot",
      shotId,
      x: origin.x,
      y: origin.y,
      a: angle,
      weapon: weapon.id,
      sound: i === 0,
      ...options,
    });
  }
  burst(
    origin.x + Math.cos(aim) * 28,
    origin.y + Math.sin(aim) * 28,
    "#fff2a8",
    weapon.pellets + 4,
  );
  gunSound(origin.x, origin.y, weapon.id);
  return weapon.cooldown;
}

function spawnCarExplosion(x: number, y: number, carColor: string, broadcast = false) {
  const debris: Debris[] = Array.from({ length: 18 }, (_, index) => {
    const angle = Math.random() * Math.PI * 2;
    const speed = Mathf.randRange(90, 330);
    return {
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      spin: Mathf.randRange(-9, 9),
      angle,
      size: Mathf.randRange(3, 8),
      color: index % 3 === 0 ? carColor : index % 2 ? "#ffb24f" : "#3a4142",
    };
  });
  const smoke: Smoke[] = Array.from({ length: 10 }, (_, index) => ({
    angle: (index / 10) * Math.PI * 2 + Mathf.randRange(-0.3, 0.3),
    distance: Mathf.randRange(12, 42),
    size: Mathf.randRange(14, 28),
  }));
  explosions.push({ x, y, age: 0, duration: 1.35, debris, smoke });
  burst(x, y, "#ffd06a", 34);
  carExplosionSound(x, y);
  const listener = player.inCar ? car : player;
  const distance = Math.hypot(x - listener.x, y - listener.y);
  Camera.shake(Mathf.clamp(16 - distance / 100, 3, 16), 480);
  if (broadcast) send({ type: "car-explosion", x, y });
}

function burst(x: number, y: number, sparkColor: string, count: number) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = Mathf.randRange(40, 190);
    sparks.push({
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      life: Mathf.randRange(0.18, 0.5),
      color: sparkColor,
    });
  }
}

function damagePlayer(amount: number) {
  if (gameState !== "alive" || performance.now() < spawnProtectedUntil) return;
  player.health -= amount;
  playerFlash.hit();
  burst(player.x, player.y, "#ff6b72", 14);
  const fatal = player.health <= 0;
  damageSound(fatal);
  if (fatal) {
    player.health = 0;
    player.inCar = false;
    goToState("dead", Transitions.fade(520, "#24080b"));
  }
}

function damageCar(amount: number, targetCar = car) {
  if (targetCar.health <= 0) return;
  targetCar.health = Math.max(0, targetCar.health - amount);
  targetCar.flash.hit();
  burst(targetCar.x, targetCar.y, "#ffb36b", 12);
  if (targetCar.health <= 0) {
    targetCar.respawn = 4;
    spawnCarExplosion(targetCar.x, targetCar.y, CAR_TYPES[targetCar.type].color, true);
    if (player.inCar && targetCar === car) damagePlayer(100);
    targetCar.body.vx = targetCar.body.vy = targetCar.body.spin = 0;
    targetCar.body.raw.setActive(false);
  } else {
    crashSound(85 + amount * 3);
  }
}

function resetPlayer() {
  life++;
  player.health = 100;
  player.inCar = false;
  player.knockX = 0;
  player.knockY = 0;
  spawnProtectedUntil = performance.now() + 3000;
  player.x = spawn.x;
  player.y = spawn.y;
  car = cars.find((candidate) => candidate.health > 0) ?? cars[0];
  carBody = car.body;
  cameraFocus.x = player.x;
  cameraFocus.y = player.y;
  camera.snapTo(cameraFocus.x, cameraFocus.y);
  burst(player.x, player.y, color, 24);
}

function separateFootFrom(x: number, y: number, radius: number) {
  if (player.inCar || gameState !== "alive") return;
  const hit = Collision.separateCircles(player.x, player.y, 13, x, y, radius);
  if (!hit) return;
  moveCircle(player, hit.nx * hit.depth, hit.ny * hit.depth, 13);
}

function repelCarFrom(x: number, y: number, radius: number) {
  const hit = Collision.separateCircles(car.x, car.y, 28, x, y, radius);
  if (!hit) return false;
  carBody.x += hit.nx * hit.depth * 0.72;
  carBody.y += hit.ny * hit.depth * 0.72;
  carBody.applyImpulse(hit.nx * 45, hit.ny * 45);
  return true;
}

// Rear-wheel world positions for a car centred at (x, y) facing `angle`.
// Shared by the local car and remote cars so their skid marks are identical.
function rearWheels(x: number, y: number, angle: number): [Wheel, Wheel] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rearX = x - c * 21;
  const rearY = y - s * 21;
  return [
    { x: rearX - s * 11, y: rearY + c * 11 },
    { x: rearX + s * 11, y: rearY - c * 11 },
  ];
}

function updateTireMarks(dt: number) {
  for (let i = tireMarks.length - 1; i >= 0; i--) {
    tireMarks[i].life -= dt;
    if (tireMarks[i].life <= 0) tireMarks.splice(i, 1);
  }
  if (!player.inCar || gameState !== "alive") {
    previousRearWheels = null;
    return;
  }
  tireMarkTimer -= dt;
  const speed = Math.hypot(car.vx, car.vy);
  const marking = tireSlip > 24 || Keys.down("Space") || speed > 300;
  const wheels = rearWheels(car.x, car.y, car.angle);
  if (marking && previousRearWheels && tireMarkTimer <= 0) {
    const alpha = Mathf.clamp(0.18 + tireSlip / 420, 0.18, 0.58);
    for (let i = 0; i < 2; i++) {
      tireMarks.push({
        ...previousRearWheels[i],
        x2: wheels[i].x,
        y2: wheels[i].y,
        life: 9,
        alpha,
      });
    }
    if (tireMarks.length > 700) tireMarks.splice(0, tireMarks.length - 700);
    tireMarkTimer = 0.025;
  }
  previousRearWheels = wheels;
}

// Remote cars leave skid marks too, generated locally from their interpolated
// motion (no protocol change). We derive speed and lateral (car-space) slip
// from the per-frame change in the interpolated car pose, mirroring the local
// car's `tireSlip`/threshold and alpha ramp, and feed the SAME `tireMarks`
// array so remote marks age and render through the existing path.
function updateRemoteTireMarks(dt: number) {
  if (dt <= 0) return;
  for (const remote of remotes.values()) {
    const state = remote.interp.sample();
    // Only a live, in-car remote lays rubber. Anything else clears tracking so
    // a later re-entry or teleport can't sweep a streak across the map.
    if (!state || state.phase !== "alive" || state.mode === "foot" || state.carAlive === false) {
      remote.prevCar = null;
      continue;
    }
    const prev = remote.prevCar;
    remote.tireMarkTimer -= dt;
    if (prev && remote.tireMarkTimer <= 0) {
      const dx = state.cx - prev.x;
      const dy = state.cy - prev.y;
      const speed = Math.hypot(dx, dy) / dt;
      const c = Math.cos(state.ca);
      const s = Math.sin(state.ca);
      // Lateral (sideways) speed in car space — the same quantity the local
      // car uses as `tireSlip` (minus the unobservable handbrake bonus).
      const slip = Math.abs(-s * dx + c * dy) / dt;
      if (slip > 24 || speed > 300) {
        const alpha = Mathf.clamp(0.18 + slip / 420, 0.18, 0.58);
        const prevWheels = rearWheels(prev.x, prev.y, prev.a);
        const wheels = rearWheels(state.cx, state.cy, state.ca);
        for (let i = 0; i < 2; i++) {
          tireMarks.push({
            ...prevWheels[i],
            x2: wheels[i].x,
            y2: wheels[i].y,
            life: 9,
            alpha,
          });
        }
        if (tireMarks.length > 700) tireMarks.splice(0, tireMarks.length - 700);
        remote.tireMarkTimer = 0.025;
      }
    }
    remote.prevCar = { x: state.cx, y: state.cy, a: state.ca };
  }
}

function updateActors(dt: number) {
  for (const fleetCar of cars) {
    if (fleetCar.health > 0 && (!player.inCar || fleetCar !== car)) {
      separateFootFrom(fleetCar.x, fleetCar.y, 29);
    }
  }
  for (const enemy of enemies) {
    const state = enemy.interp.sample();
    if (!state) continue;
    enemy.x = state.x;
    enemy.y = state.y;
    enemy.vx = state.vx;
    enemy.vy = state.vy;
    enemy.health = state.health;
    enemy.dead = state.dead ? 1 : 0;
    enemy.ramCooldown = Math.max(0, (enemy.ramCooldown ?? 0) - dt);
    if (!enemy.dead) separateFootFrom(enemy.x, enemy.y, 14);
    if (
      gameState === "alive" &&
      player.inCar &&
      !enemy.dead &&
      enemy.ramCooldown <= 0 &&
      Collision.circleHit(car.x, car.y, 28, enemy.x, enemy.y, 14)
    ) {
      const speed = Math.hypot(car.vx, car.vy);
      repelCarFrom(enemy.x, enemy.y, 14);
      if (speed > 70) {
        enemy.ramCooldown = 0.5;
        send({
          type: "hit",
          part: "bot",
          target: enemy.id,
          damage: Math.min(100, speed * 0.18),
          ix: car.vx * 0.78,
          iy: car.vy * 0.78,
        });
        enemy.flash.hit();
        carBody.applyImpulse(-car.vx * 0.12, -car.vy * 0.12);
        burst(enemy.x, enemy.y, "#ffcf73", 16);
      }
    }
  }

  for (const [remoteId, remote] of remotes) {
    const state = remote.interp.sample();
    if (!state || state.phase !== "alive") continue;
    if (state.carAlive !== false) {
      separateFootFrom(state.cx, state.cy, 28);
      if (player.inCar && Collision.circleHit(car.x, car.y, 28, state.cx, state.cy, 28)) {
        const key = `${remoteId}:car`;
        const ready = (actorCollisionCooldown.get(key) ?? 0) <= performance.now();
        if (repelCarFrom(state.cx, state.cy, 28) && ready) {
          actorCollisionCooldown.set(key, performance.now() + 450);
          const speed = Math.hypot(car.vx, car.vy);
          send({
            type: "hit",
            part: "car",
            target: remoteId,
            damage: Math.min(24, speed * 0.035),
            ix: -car.vx * 0.08,
            iy: -car.vy * 0.08,
          });
        }
      }
    }
    if (state.mode === "foot") {
      separateFootFrom(state.px, state.py, 14);
      if (player.inCar && Collision.circleHit(car.x, car.y, 28, state.px, state.py, 14)) {
        const key = `${remoteId}:player`;
        const ready = (actorCollisionCooldown.get(key) ?? 0) <= performance.now();
        if (repelCarFrom(state.px, state.py, 14) && ready) {
          actorCollisionCooldown.set(key, performance.now() + 450);
          send({
            type: "hit",
            part: "player",
            target: remoteId,
            damage: Math.min(40, Math.hypot(car.vx, car.vy) * 0.07),
            ix: car.vx * 0.82,
            iy: car.vy * 0.82,
          });
        }
      }
    }
  }

  if (gameState === "alive") {
    for (const [pickupId, entity] of pickupEntities) {
      const pickup = pickupWorld.get(entity, Pickup);
      const useful =
        pickup &&
        (pickup.kind === "weapon" ? !ownedWeapons.has(pickup.weapon ?? "") : player.health < 100);
      if (
        !useful ||
        !Collision.circleHit(player.x, player.y, player.inCar ? 28 : 13, pickup.x, pickup.y, 16)
      ) {
        continue;
      }
      send({ type: "pickup", pickupId });
      pickupWorld.despawn(entity);
      pickupEntities.delete(pickupId);
      break;
    }
  }
}

function updateExplosions(dt: number) {
  for (let i = enemyDeaths.length - 1; i >= 0; i--) {
    enemyDeaths[i].age += dt;
    if (enemyDeaths[i].age >= enemyDeaths[i].duration) enemyDeaths.splice(i, 1);
  }
  for (let i = explosions.length - 1; i >= 0; i--) {
    const explosion = explosions[i];
    explosion.age += dt;
    for (const debris of explosion.debris) {
      debris.x += debris.vx * dt;
      debris.y += debris.vy * dt;
      debris.vx *= Math.exp(-2.4 * dt);
      debris.vy = debris.vy * Math.exp(-2.1 * dt) + 150 * dt;
      debris.angle += debris.spin * dt;
    }
    if (explosion.age >= explosion.duration) explosions.splice(i, 1);
  }
}

function updateProjectiles(dt: number) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    const blocked =
      b.x < 0 ||
      b.y < 0 ||
      b.x > WORLD.w ||
      b.y > WORLD.h ||
      solids.some((r) => Collision.circleRect(b.x, b.y, 3, r));
    let hit = false;
    if (blocked) burst(b.x, b.y, "#ffc56b", 4);

    // Every projectile is blocked by every local fleet car, whether parked or
    // occupied. Local/bot shots apply fleet damage immediately; peer damage to
    // the actively networked car still arrives through its targeted hit event.
    const struckCar = cars.find(
      (candidate) =>
        candidate.health > 0 && Collision.circleHit(b.x, b.y, 3, candidate.x, candidate.y, 30),
    );
    if (struckCar) {
      if (b.local || b.hostile || struckCar !== car || !player.inCar) {
        damageCar(b.damage * 0.85, struckCar);
      }
      struckCar.flash.hit();
      burst(b.x, b.y, "#ffb36b", 10);
      hit = true;
    }

    if (
      !hit &&
      gameState === "alive" &&
      b.hostile &&
      Collision.circleHit(b.x, b.y, 3, player.x, player.y, player.inCar ? 27 : 13)
    ) {
      damagePlayer(b.damage);
      hit = true;
    }

    if (b.local && !hit) {
      const enemy = enemies.find(
        (target) => target.dead <= 0 && Collision.circleHit(b.x, b.y, 3, target.x, target.y, 14),
      );
      if (enemy) {
        enemy.flash.hit();
        send({
          type: "hit",
          part: "bot",
          target: enemy.id,
          shotId: b.shotId,
          damage: b.damage,
          ix: b.vx * 0.08,
          iy: b.vy * 0.08,
        });
        burst(b.x, b.y, "#ff9b74", 10);
        hit = true;
      }
    }

    if (b.local && !hit) {
      for (const [remoteId, remote] of remotes) {
        const state = remote.interp.sample();
        if (!state || state.phase === "dead") continue;
        if (state.carAlive !== false && Collision.circleHit(b.x, b.y, 3, state.cx, state.cy, 28)) {
          remote.carFlash.hit();
          send({
            type: "hit",
            part: "car",
            target: remoteId,
            shotId: b.shotId,
            damage: b.damage * 0.85,
          });
          burst(b.x, b.y, "#ffb36b", 14);
          hit = true;
          break;
        }
        if (state.mode === "foot" && Collision.circleHit(b.x, b.y, 3, state.px, state.py, 14)) {
          send({
            type: "hit",
            part: "player",
            target: remoteId,
            shotId: b.shotId,
            damage: b.damage,
          });
          burst(b.x, b.y, "#ffdf8a", 12);
          hit = true;
          break;
        }
      }
    }

    if (blocked || hit || b.life <= 0) bullets.splice(i, 1);
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= Math.exp(-5 * dt);
    p.vy *= Math.exp(-5 * dt);
    p.life -= dt;
    if (p.life <= 0) sparks.splice(i, 1);
  }
}

let sendStep = 0;
const { drawCarHealth, drawEnterCarPrompt, drawInventory, drawMinimap, drawPlayerHealth } =
  createRoadHud(() => ({
    Pickup,
    activeWeapon,
    buildings,
    camera,
    car,
    cars,
    color,
    enemies,
    gameState,
    nearestEnterableCar,
    ownedWeapons,
    pickupWorld,
    player,
    remotes,
    selectWeapon(slot: number) {
      activeWeapon = slot;
      radioSound();
    },
    vp,
  }));

Loop.run({
  update() {
    const dtMs = Loop.step;
    const dt = dtMs / 1000;
    let wantsToShoot = false;
    transition?.advance(dtMs);
    if (transition?.done) transition = null;

    if (gameState === "alive") {
      for (let slot = 0; slot < WEAPONS.length; slot++) {
        if (Keys.pressed(`Digit${slot + 1}`) && ownedWeapons.has(WEAPONS[slot].id)) {
          activeWeapon = slot;
          radioSound();
        }
      }
      if (Keys.pressed("KeyE")) tryToggleCar();
      if (player.inCar) updateCar(dt);
      else {
        const dx =
          (Keys.down("KeyD") || Keys.down("ArrowRight") ? 1 : 0) -
          (Keys.down("KeyA") || Keys.down("ArrowLeft") ? 1 : 0);
        const dy =
          (Keys.down("KeyS") || Keys.down("ArrowDown") ? 1 : 0) -
          (Keys.down("KeyW") || Keys.down("ArrowUp") ? 1 : 0);
        const len = Math.hypot(dx, dy) || 1;
        moveCircle(player, (dx / len) * 220 * dt, (dy / len) * 220 * dt, 13);
        moveCircle(player, player.knockX * dt, player.knockY * dt, 13);
        const knockDrag = Math.exp(-2.8 * dt);
        player.knockX *= knockDrag;
        player.knockY *= knockDrag;
      }

      shotCooldown -= dt;
      if (!player.inCar && Mouse.inside && Mouse.down && shotCooldown <= 0) wantsToShoot = true;
    }
    for (const fleetCar of cars) {
      if (fleetCar.respawn > 0) {
        fleetCar.respawn -= dt;
        if (fleetCar.respawn <= 0) {
          fleetCar.health = 100;
          fleetCar.body.x = fleetCar.spawnX;
          fleetCar.body.y = fleetCar.spawnY;
          fleetCar.body.rot = clientNo % 2 ? 0 : Math.PI;
          fleetCar.body.vx = fleetCar.body.vy = fleetCar.body.spin = 0;
          fleetCar.body.raw.setActive(true);
          fleetCar.body.wake();
        }
      }
    }
    updateActors(dt);
    physics.step(dtMs);
    for (const fleetCar of cars) {
      fleetCar.x = fleetCar.body.x;
      fleetCar.y = fleetCar.body.y;
      fleetCar.angle = fleetCar.body.rot;
      fleetCar.vx = fleetCar.body.vx;
      fleetCar.vy = fleetCar.body.vy;
    }
    for (const prop of props) {
      prop.x = prop.body!.x;
      prop.y = prop.body!.y;
    }
    if (player.inCar) {
      player.x = car.x;
      player.y = car.y;
    }
    updateTireMarks(dt);
    updateRemoteTireMarks(dt);
    updateExplosions(dt);
    updateProjectiles(dt);
    if (gameState !== "alive" || !player.inCar) {
      engineLoad *= 0.85;
      tireSlip *= 0.8;
    }
    updateEngineSound(engineLoad, tireSlip);

    if (gameState === "alive") {
      const aimX = camera.wx(Mouse.x);
      const aimY = camera.wy(Mouse.y);
      player.angle = Math.atan2(aimY - player.y, aimX - player.x);
      if (wantsToShoot) shotCooldown = shoot();
    }

    if (++sendStep % 3 === 0) {
      send({
        type: "state",
        life,
        phase: gameState,
        mode: gameState === "dead" ? "dead" : player.inCar ? "car" : "foot",
        px: player.x,
        py: player.y,
        pa: player.angle,
        vx: player.inCar ? car.vx : 0,
        vy: player.inCar ? car.vy : 0,
        cx: car.x,
        cy: car.y,
        ca: car.angle,
        health: player.health,
        carHealth: car.health,
        carAlive: car.health > 0,
        carId: car.id,
        carType: car.type,
      });
    }
    const now = performance.now();
    for (const [rid, remote] of remotes) if (now - remote.lastSeen > 5000) remotes.delete(rid);
  },

  draw() {
    const { ctx } = Draw;
    const observed = remotes.values().next().value?.interp.sample();
    const target =
      gameState === "spectator" && observed
        ? { x: observed.px, y: observed.py }
        : player.inCar
          ? car
          : player;
    let cameraTargetX = target.x;
    let cameraTargetY = target.y;
    if (gameState === "alive" && Mouse.inside) {
      cameraTargetX += (Mouse.x - vp.w / 2) * 0.42;
      cameraTargetY += (Mouse.y - vp.h / 2) * 0.42;
    }
    const cameraFollow = 1 - Math.pow(1 - 0.14, Draw.frameScale);
    cameraFocus.x = Mathf.lerp(cameraFocus.x, cameraTargetX, cameraFollow);
    cameraFocus.y = Mathf.lerp(cameraFocus.y, cameraTargetY, cameraFollow);
    camera.snapTo(cameraFocus.x, cameraFocus.y);

    ctx.fillStyle = "#101719";
    ctx.fillRect(0, 0, vp.w, vp.h);
    // The camera transform (and its shake) fold into `Camera.render`.
    Camera.render(() => {
      drawWorld(ctx, buildings, cover);
      ctx.lineWidth = 3;
      ctx.lineCap = "round";
      for (const mark of tireMarks) {
        ctx.globalAlpha = mark.alpha * Mathf.clamp(mark.life / 2, 0, 1);
        ctx.strokeStyle = "#080c0d";
        ctx.beginPath();
        ctx.moveTo(mark.x, mark.y);
        ctx.lineTo(mark.x2, mark.y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
      for (const prop of props) drawProp(ctx, prop);
      for (const pickup of pickupWorld.dense(Pickup)) drawPickup(ctx, pickup);
      for (const enemy of enemies) if (enemy.dead <= 0) drawEnemy(ctx, enemy, player);
      for (const death of enemyDeaths) drawEnemyDeath(ctx, death);
      for (const remote of remotes.values()) {
        const state = remote.interp.sample();
        if (state) drawRemote(ctx, state, remote);
      }
      if (gameState === "alive") {
        for (const fleetCar of cars) {
          if (fleetCar.health <= 0) continue;
          drawCar(
            ctx,
            fleetCar.x,
            fleetCar.y,
            fleetCar.angle,
            CAR_TYPES[fleetCar.type].color,
            player.inCar && fleetCar === car,
            fleetCar.flash.value,
            fleetCar.type,
          );
        }
      }
      if (gameState === "alive" && !player.inCar) {
        drawPerson(ctx, player.x, player.y, player.angle, color, true, playerFlash.value);
      }
      for (const b of bullets) {
        ctx.strokeStyle = b.color ?? "#fff";
        ctx.lineWidth = b.local ? 3 : 2;
        ctx.beginPath();
        ctx.moveTo(b.px, b.py);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const explosion of explosions) drawCarExplosion(ctx, explosion);
      for (const p of sparks) {
        ctx.globalAlpha = Mathf.clamp(p.life * 3, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;
    });

    // World prompts render before the fixed HUD, so the roster always wins
    // z-order when the car is underneath it.
    drawEnterCarPrompt();

    const rosterRows: RosterRow[] = [
      {
        label: `YOU · CLIENT ${clientNo}`,
        status: `${gameState} · ${Math.ceil(player.health)} HP · CAR ${Math.ceil(car.health)}`,
        color,
        local: true,
      },
      ...[...remotes.values()].map((remote, index) => {
        const state = remote.interp.sample();
        return {
          label: `PLAYER ${index + 2}`,
          status: `${state?.phase ?? "joining"} · ${Math.ceil(state?.health ?? 100)} HP`,
          color: remote.color,
        };
      }),
      ...enemies.map((enemy, index) => ({
        label: `BOT ${index + 1}`,
        status: enemy.dead ? "respawning" : `${Math.ceil(enemy.health)} HP`,
        color: "#ff8a75",
      })),
    ];
    const rowH = 17;
    const rosterW = 320;
    const rosterH = 58 + rosterRows.length * rowH;
    const listRect = { x: 18, y: 58, w: rosterW - 16, h: rosterRows.length * rowH };
    UI.panel({ x: 10, y: 10, w: rosterW, h: rosterH, title: "PLAYERS + BOTS" });
    UI.text(`${transport.state.toUpperCase()} · ${score} PTS`, {
      x: 22,
      y: 39,
      h: 17,
      size: 10,
      color: transport.state === "connected" ? "#6bff9e" : "#ffb454",
    });
    for (let i = 0; i < rosterRows.length; i++) {
      const entry = rosterRows[i];
      const row = {
        x: listRect.x,
        y: listRect.y + i * rowH,
        w: listRect.w,
        h: rowH,
      };
      UI.listItem({ ...row, selected: entry.local });
      UI.text(entry.label, {
        ...row,
        x: row.x + 6,
        w: 92,
        size: 9,
        bold: true,
        color: entry.color,
      });
      UI.text(entry.status, {
        ...row,
        x: row.x + 100,
        w: row.w - 106,
        align: "right",
        size: 9,
        color: "dim",
      });
    }
    drawMinimap(ctx);
    if (gameState === "alive") drawPlayerHealth();
    if (gameState === "alive" && player.inCar) drawCarHealth();
    if (gameState === "alive") drawInventory();
    if (gameState === "alive") {
      UI.text(player.inCar ? "E EXIT · WASD DRIVE · SPACE HANDBRAKE" : "WASD MOVE · MOUSE FIRE", {
        x: vp.w / 2,
        y: vp.h - 34,
        align: "center",
        size: 13,
        bold: true,
        color: "#dce7e7",
      });
    } else if (gameState === "spectator") {
      const join = { x: vp.w / 2 - 180, y: vp.h / 2 - 92, w: 360, h: 184 };
      UI.panel({ ...join, title: "ROAD RIVALS" });
      UI.text("SPECTATING", {
        x: join.x,
        y: join.y + 42,
        w: join.w,
        h: 24,
        align: "center",
        size: 16,
        bold: true,
        color: "#8ff4dd",
      });
      UI.text("Watch the shared fight, then enter when ready.", {
        x: join.x,
        y: join.y + 72,
        w: join.w,
        h: 22,
        align: "center",
        size: 11,
        color: "dim",
      });
      if (
        UI.button({
          id: "road-rivals:join",
          x: join.x + 90,
          y: join.y + 116,
          w: 180,
          h: 42,
          label: "JOIN GAME",
          variant: "primary",
        })
      ) {
        unlockRoadAudio();
        joinSound();
        goToState("alive", joinTransition);
      }
    } else if (gameState === "dead") {
      const box = UI.modal({ w: 350, h: 180, title: "YOU DIED" });
      UI.text(`SCORE  ${score}`, {
        x: box.x,
        y: box.y + 48,
        w: box.w,
        h: 26,
        align: "center",
        size: 18,
        bold: true,
        color: "#ff8a75",
      });
      UI.text("Your rival or a bot got the better of you.", {
        x: box.x,
        y: box.y + 78,
        w: box.w,
        h: 22,
        align: "center",
        size: 11,
        color: "dim",
      });
      if (
        UI.button({
          id: "road-rivals:respawn",
          x: box.x + 95,
          y: box.y + 118,
          w: 160,
          h: 38,
          label: "RESPAWN",
          variant: "primary",
        })
      ) {
        joinSound();
        goToState("alive", Transitions.wipe(500, "up", "#071012"));
      }
    }
    transition?.draw(ctx, vp);
    if (gameState === "alive" && Mouse.inside) {
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(Mouse.x, Mouse.y, 8, 0, Math.PI * 2);
      ctx.moveTo(Mouse.x - 13, Mouse.y);
      ctx.lineTo(Mouse.x - 5, Mouse.y);
      ctx.moveTo(Mouse.x + 5, Mouse.y);
      ctx.lineTo(Mouse.x + 13, Mouse.y);
      ctx.moveTo(Mouse.x, Mouse.y - 13);
      ctx.lineTo(Mouse.x, Mouse.y - 5);
      ctx.moveTo(Mouse.x, Mouse.y + 5);
      ctx.lineTo(Mouse.x, Mouse.y + 13);
      ctx.stroke();
      Loop.setCursor("none");
    }
    OnscreenInput.drawControls(pad);
  },
});
