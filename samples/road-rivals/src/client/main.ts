import { createNetMeter, createPerformanceMonitoring } from "minimotor/performance";
import { createCamera } from "minimotor/camera";
import { createAudio } from "minimotor/audio";
import { createInput } from "minimotor/input";
import { createNet } from "minimotor/net";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createUI } from "minimotor/ui";
// Road Rivals — top-down shooter + enterable car + WebSocket multiplayer.
// Local movement/vehicle simulation is authoritative. Remote actors are drawn
// 100 ms in the past from Net.createInterpolator snapshot buffers.
import { Collision, ECS, Gizmos, Goodies, Mathf, App, Transitions } from "minimotor";
import { Car, Entity, Flash, Interpolator, Skidmarks, Transition, TransitionRun } from "minimotor";
import { createPhysics2D } from "minimotor/physics2d";
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
  // Shared arcade-driving model (Gizmos.car) bound to this car's body.
  drive: Car;
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
// Per-remote VIEW data. Interpolation, last-seen and prune/join bookkeeping live
// in `remoteRoster` (Net.createRoster); `sample()` is a bound view onto this
// peer's interpolated state, so call sites (and the HUD) never touch the roster.
interface Remote {
  color: string;
  carFlash: Flash;
  life: number;
  sample: () => RemoteState | null;
  // Previous interpolated car pose, used to derive skid slip/speed locally (no
  // extra netcode). Null when the remote isn't in a live car, so a respawn or
  // teleport can't sweep a streak across the map.
  prevCar: { x: number; y: number; a: number } | null;
  // This remote's own skid trail, laid from its interpolated motion.
  skids: Skidmarks;
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
  text?: string;
}
interface RosterRow {
  label: string;
  status: string;
  color: string;
  local?: boolean;
}

const meter = createNetMeter();
// The viewport is LIVE (mutated on resize); the engine clears to `background`.
const game = App.create("game", {
  background: "#101719",
  // Fixed 16:9 logical stage, letterboxed INSIDE the safe area — so on a notched
  // phone the play field never draws under the notch/home-indicator (the bars
  // absorb it) and the aspect ratio is stable across devices. Tune the numbers to
  // taste: larger = more world visible (more zoomed out).
  resolution: { w: 1600, h: 900 },
  barColor: "#0a0d0f",
  // Inject the engine's fullscreen handling: viewport-fit=cover so the safe-area
  // insets are real, no user zoom, and the letterbox fits inside the safe area.
  fullscreen: true,
  // Block trackpad swipe-back / overscroll so a stray gesture can't navigate
  // away mid-match.
  preventNavigation: true,
});
createPerformanceMonitoring(game);

// On-screen touch twin-stick pad: LEFT stick moves/steers+throttles, RIGHT stick
const vp = game.viewport;
const { Clock, Draw, Keys, Loop, Mouse } = game;
const Camera = createCamera(game);
const Audio = createAudio(game);
const Input = createInput(game);
const Net = createNet(game);
const Physics2D = createPhysics2D(game);
const UI = createUI(game, Input);
const OnscreenInput = createOnscreenInput(game, Input);
// aims + auto-fires, HANDBRAKE (hold) and a contextual ENTER/EXIT CAR button.
// Autohide keeps it hidden on desktop and shown on touch (default), so keyboard
// + mouse are unaffected. `tryToggleCar`/`nearestEnterableCar`/`player` are used
// only inside the button callbacks, which run at frame/tap time (well after init).
const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  stick: { anchor: { side: "left", x: 100, y: 100 }, radius: 64 },
  rightStick: { anchor: { side: "right", x: 100, y: 100 }, radius: 64 },
  buttons: [
    { anchor: { side: "right", x: 96, y: 216 }, r: 34, button: "b", label: "BRAKE" },
    {
      anchor: { side: "left", x: 96, y: 216 },
      r: 34,
      label: "CAR",
      onTap: () => tryToggleCar(),
      disabled: () => !player.inCar && !nearestEnterableCar(),
    },
  ],
});
// Right-stick magnitude past this engages stick-aim + continuous fire.
const AIM_DEADZONE = 0.3;

const clientNo = Number(new URLSearchParams(location.search).get("client") || 1);
const id = `${clientNo}-${Math.random().toString(36).slice(2, 7)}`;
const COLORS = ["#52e0c4", "#ffcb5c", "#ff6b72", "#8da1ff", "#d18cff"];
const color = COLORS[(clientNo - 1) % COLORS.length];
const spawn =
  clientNo % 2
    ? { x: roadsX[0], y: roadsY[0] }
    : { x: roadsX[roadsX.length - 1], y: roadsY[roadsY.length - 1] };

const playerFlash = Gizmos.flash(150, Clock.world);
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
  flash: Gizmos.flash(180, Clock.world),
  body: null as unknown as Body2D,
  drive: null as unknown as Car,
}));
let car = cars[0];
let carBody: Body2D = null as unknown as Body2D;
// The game lerps `cameraFocus` itself (mouse-look offset + spectator target),
// so its primary camera follows it rigidly; the world clamp comes for free.
const cameraFocus = { x: spawn.x, y: spawn.y };
Camera.follow(cameraFocus, { world: WORLD, damping: 1 });
Camera.snap();

// Small adapter over the game-bound Camera API: the old bespoke camera exposed
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
// Skid trails for local and remote cars. All four tyres lay rubber: the rear
// pair sits at the gizmo's default position (along -21, across ±11) and the
// front pair mirrors it at the front axle — drawCar paints the wheels
// symmetrically fore/aft of the body centre (rear at -w/2+11, front at
// w/2-11, i.e. ±16..22 across the car types, so ±21 splits the difference).
const SKID_OPTIONS = {
  wheels: [
    { along: -21, across: -11 },
    { along: -21, across: 11 },
    { along: 21, across: -11 },
    { along: 21, across: 11 },
  ],
};
const localSkids = Gizmos.skidmarks(SKID_OPTIONS);
// Net.createRoster owns each remote's interpolator, last-seen and join/prune
// bookkeeping (with the wrap-safe `blendState` blend); `remotes` holds only the
// matching view data.
const remoteRoster = Net.createRoster<RemoteState>({ delayMs: 100, lerp: blendState });
const remotes = new Map<string, Remote>();
let score = 0;
let life = 0;
// In-match chat: messages broadcast over the existing net channel (see the
// "chat" branch in transport.onMessage and the send() below). `chatDraft` is
// the controlled value for the UI.textInput each frame.
const chatLog: { name: string; text: string; color: string }[] = [];
let chatDraft = "";
const CHAT_MAX = 40;
const chatName = (peerId: string) => `P${peerId.split("-")[0] || "?"}`;
let spawnProtectedUntil = 0;
const ownedWeapons = new Set<string>(["pistol"]);
let activeWeapon = 0;
let gameState = "spectator";
let transition: TransitionRun | null = null;
const actorCollisionCooldown = new Map<string, number>();

const { buildings, cover, props, solids } = createRoadWorld();
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
  // The engine's arcade-car model drives this body's tire-space velocity; the
  // per-type tuning (acceleration/grip/steer) comes straight from CAR_TYPES.
  fleetCar.drive = Gizmos.car(fleetCar.body, config);
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
} = createRoadAudio(Audio, () => ({ player, car, gameState }));
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

function blendState(a: RemoteState, b: RemoteState, t: number): RemoteState {
  return {
    ...b,
    px: Mathf.lerp(a.px, b.px, t),
    py: Mathf.lerp(a.py, b.py, t),
    pa: Mathf.lerpAngle(a.pa, b.pa, t),
    cx: Mathf.lerp(a.cx, b.cx, t),
    cy: Mathf.lerp(a.cy, b.cy, t),
    ca: Mathf.lerpAngle(a.ca, b.ca, t),
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
          flash: Gizmos.flash(130, Clock.world),
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
  if (msg.type === "chat") {
    if (msg.text) {
      chatLog.push({
        name: chatName(msg.id ?? ""),
        text: msg.text.slice(0, 80),
        color: msg.color ?? "#fff",
      });
      if (chatLog.length > CHAT_MAX) chatLog.shift();
    }
    return;
  }
  if (msg.type === "bye") {
    const peerId = msg.id ?? "";
    remoteRoster.remove(peerId);
    return void remotes.delete(peerId);
  }
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
  const peerId = msg.id ?? "";
  // The roster stamps last-seen, creates the interpolator on first sight and
  // pushes the snapshot; `isNew` tells us to spin up the matching view entry.
  const { isNew } = remoteRoster.update(peerId, msg as unknown as RemoteState);
  let remote = remotes.get(peerId);
  if (isNew || !remote) {
    remote = {
      color: msg.color ?? "#fff",
      carFlash: Gizmos.flash(180, Clock.world),
      life: msg.life ?? 0,
      sample: (atMs?: number) => remoteRoster.sampleOne(peerId, atMs),
      prevCar: null,
      skids: Gizmos.skidmarks(SKID_OPTIONS),
    };
    remotes.set(peerId, remote);
  }
  if (remote.life !== msg.life) {
    remote.life = msg.life ?? 0;
    remoteRoster.reset(peerId); // respawns/teleports must snap, never sweep
    remote.prevCar = null; // ...and must not draw a skid across the teleport
  }
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

// Drive the active car through the shared `Gizmos.car` arcade model: it owns the
// longitudinal engine/brake forces, lateral tire grip, handbrake drift and
// wheelbase yaw, writing tire-space velocity onto the body for the Physics2D
// solver to resolve. Here we only gather input and mirror telemetry back for the
// audio, skidmarks and renderer to read.
function updateCar(dt: number) {
  // Left stick Y drives the throttle (screen-down axis is positive, so up = fwd,
  // down = reverse/brake); WASD/arrows fold into the same axis. Analog throttle
  // now scales acceleration proportionally (the gizmo's model).
  const throttle = Mathf.clamp(
    (Keys.down("KeyW") || Keys.down("ArrowUp") ? 1 : 0) -
      (Keys.down("KeyS") || Keys.down("ArrowDown") ? 1 : 0) -
      pad.axis(1),
    -1,
    1,
  );
  const steer = Mathf.clamp(
    (Keys.down("KeyD") || Keys.down("ArrowRight") ? 1 : 0) -
      (Keys.down("KeyA") || Keys.down("ArrowLeft") ? 1 : 0) +
      pad.axis(0),
    -1,
    1,
  );
  const handbrake = Keys.down("Space") || pad.down(Input.Buttons.B);
  car.drive.drive({ throttle, steer, handbrake }, dt);
  // Mirror body pose + telemetry into the fields the rest of the sample reads.
  car.angle = carBody.rot;
  car.vx = carBody.vx;
  car.vy = carBody.vy;
  car.steer = car.drive.steerAngle;
  engineLoad = car.drive.engineLoad;
  tireSlip = car.drive.tireSlip;
}

function nearestEnterableCar(): FleetCar | null {
  return Goodies.nearest(
    player.x,
    player.y,
    cars.filter((candidate) => candidate.health > 0),
    (candidate) => candidate,
    ENTER_CAR_RANGE,
  );
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

// True while the right stick is pushed past the deadzone (touch aim is live).
function rightStickEngaged() {
  return OnscreenInput.visible(pad) && Math.hypot(pad.axis(2), pad.axis(3)) > AIM_DEADZONE;
}

// Aim source: right stick when the pad is up and engaged; otherwise the mouse —
// but never the (stale) mouse while the pad is visible, so touch play holds its
// last facing instead of snapping to a leftover cursor position.
function resolveAimAngle(origin: { x: number; y: number }) {
  if (OnscreenInput.visible(pad)) {
    return rightStickEngaged() ? Math.atan2(pad.axis(3), pad.axis(2)) : player.angle;
  }
  return cursorAimAngle(origin);
}

function shoot() {
  const origin = player.inCar ? car : player;
  const aim = resolveAimAngle(origin);
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

function updateTireMarks(dt: number) {
  // On foot / dead: keep aging existing marks but lift the pen (marking: false)
  // so a later re-entry can't sweep a fresh streak across the map.
  if (!player.inCar || gameState !== "alive") {
    localSkids.trace(car.x, car.y, car.angle, { marking: false }, dt);
    return;
  }
  const speed = Math.hypot(car.vx, car.vy);
  const marking = tireSlip > 24 || Keys.down("Space") || speed > 300;
  const alpha = Mathf.clamp(0.18 + tireSlip / 420, 0.18, 0.58);
  localSkids.trace(car.x, car.y, car.angle, { marking, alpha }, dt);
}

// Remote cars leave skid marks too, generated locally from their interpolated
// motion (no protocol change): we derive speed and lateral (car-space) slip from
// the per-frame change in the interpolated pose — the same quantity the local
// car uses as `tireSlip` — and feed each remote's own `Gizmos.skidmarks`.
function updateRemoteTireMarks(dt: number) {
  if (dt <= 0) return;
  for (const remote of remotes.values()) {
    const state = remote.sample();
    // Only a live, in-car remote lays rubber. Anything else lifts the pen and
    // drops tracking so a re-entry or teleport can't sweep a streak.
    if (!state || state.phase !== "alive" || state.mode === "foot" || state.carAlive === false) {
      remote.prevCar = null;
      remote.skids.trace(state?.cx ?? 0, state?.cy ?? 0, state?.ca ?? 0, { marking: false }, dt);
      continue;
    }
    const prev = remote.prevCar;
    let marking = false;
    let alpha = 0.45;
    if (prev) {
      const dx = state.cx - prev.x;
      const dy = state.cy - prev.y;
      const speed = Math.hypot(dx, dy) / dt;
      const c = Math.cos(state.ca);
      const s = Math.sin(state.ca);
      const slip = Math.abs(-s * dx + c * dy) / dt;
      marking = slip > 24 || speed > 300;
      alpha = Mathf.clamp(0.18 + slip / 420, 0.18, 0.58);
    }
    remote.skids.trace(state.cx, state.cy, state.ca, { marking, alpha }, dt);
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
    const state = remote.sample();
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
        const state = remote.sample();
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
  createRoadHud(UI, () => ({
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
        // Keyboard OR left stick (x = strafe, y = up/down); normalise only when
        // the combined vector exceeds 1 so analog magnitude (walk speed) survives.
        let dx =
          (Keys.down("KeyD") || Keys.down("ArrowRight") ? 1 : 0) -
          (Keys.down("KeyA") || Keys.down("ArrowLeft") ? 1 : 0) +
          pad.axis(0);
        let dy =
          (Keys.down("KeyS") || Keys.down("ArrowDown") ? 1 : 0) -
          (Keys.down("KeyW") || Keys.down("ArrowUp") ? 1 : 0) +
          pad.axis(1);
        const len = Math.hypot(dx, dy);
        if (len > 1) {
          dx /= len;
          dy /= len;
        }
        moveCircle(player, dx * 220 * dt, dy * 220 * dt, 13);
        moveCircle(player, player.knockX * dt, player.knockY * dt, 13);
        const knockDrag = Math.exp(-2.8 * dt);
        player.knockX *= knockDrag;
        player.knockY *= knockDrag;
      }

      shotCooldown -= dt;
      // Touch: auto-fire while the right stick is engaged. Desktop: mouse click.
      if (!player.inCar && shotCooldown <= 0) {
        wantsToShoot = OnscreenInput.visible(pad)
          ? rightStickEngaged()
          : Mouse.inside && Mouse.down;
      }
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
      player.angle = resolveAimAngle(player.inCar ? car : player);
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
    // Prune peers that went quiet (the roster owns the 5 s timeout), dropping
    // the matching view entry too.
    for (const id of remoteRoster.prune()) remotes.delete(id);
  },

  draw() {
    const { ctx } = Draw;
    const observed = remotes.values().next().value?.sample();
    const target =
      gameState === "spectator" && observed
        ? { x: observed.px, y: observed.py }
        : player.inCar
          ? car
          : player;
    let cameraTargetX = target.x;
    let cameraTargetY = target.y;
    if (gameState === "alive" && Mouse.inside && !OnscreenInput.visible(pad)) {
      cameraTargetX += (Mouse.x - vp.w / 2) * 0.42;
      cameraTargetY += (Mouse.y - vp.h / 2) * 0.42;
    }
    const cameraFollow = 1 - Math.pow(1 - 0.14, Loop.frameDelta / Loop.step);
    cameraFocus.x = Mathf.lerp(cameraFocus.x, cameraTargetX, cameraFollow);
    cameraFocus.y = Mathf.lerp(cameraFocus.y, cameraTargetY, cameraFollow);
    camera.snapTo(cameraFocus.x, cameraFocus.y);

    ctx.fillStyle = "#101719";
    ctx.fillRect(0, 0, vp.w, vp.h);
    // The camera transform (and its shake) fold into `Camera.render`.
    Camera.render(() => {
      drawWorld(ctx, buildings, cover);
      // Rubber under everything: the local car's trail, then each remote's.
      localSkids.draw(ctx);
      for (const remote of remotes.values()) remote.skids.draw(ctx);
      for (const prop of props) drawProp(ctx, prop);
      for (const pickup of pickupWorld.dense(Pickup)) drawPickup(ctx, pickup);
      for (const enemy of enemies) if (enemy.dead <= 0) drawEnemy(ctx, enemy, player);
      for (const death of enemyDeaths) drawEnemyDeath(ctx, death);
      for (const remote of remotes.values()) {
        const state = remote.sample();
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
        const state = remote.sample();
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
    UI.panel({ x: 10, y: 10, w: rosterW, h: rosterH, title: "PLAYERS + BOTS" }, () => {
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
    });
    drawMinimap(ctx);

    // In-match chat (bottom-left). Messages broadcast to peers via send(); the
    // text input only captures keyboard while it holds focus, so driving with
    // WASD/Space is unaffected unless the player has clicked into the field.
    const chatW = 300;
    const chatX = 10;
    const shownChat = chatLog.slice(-5);
    const chatLineH = 15;
    const chatHeaderH = 24;
    const chatInputH = 26;
    const chatBodyH = Math.max(chatLineH, shownChat.length * chatLineH);
    const chatH = chatHeaderH + chatBodyH + 8 + chatInputH + 8;
    const chatY = vp.h - chatH - 10;
    UI.panel({ x: chatX, y: chatY, w: chatW, h: chatH, title: "CHAT" }, () => {
      if (shownChat.length === 0) {
        UI.text("No messages yet.", {
          x: chatX + 10,
          y: chatY + chatHeaderH,
          w: chatW - 20,
          h: chatLineH,
          size: 10,
          color: "dim",
        });
      }
      for (let i = 0; i < shownChat.length; i++) {
        const entry = shownChat[i];
        UI.text(`${entry.name}: ${entry.text}`, {
          x: chatX + 10,
          y: chatY + chatHeaderH + i * chatLineH,
          w: chatW - 20,
          h: chatLineH,
          size: 10,
          color: entry.color,
        });
      }
      const chatResult = UI.textInput({
        id: "road-rivals:chat",
        value: chatDraft,
        x: chatX + 8,
        y: chatY + chatHeaderH + chatBodyH + 8,
        w: chatW - 16,
        h: chatInputH,
        placeholder: "Message…",
        maxLength: 80,
        blurOnSubmit: false,
      });
      chatDraft = chatResult.value;
      if (chatResult.submitted && chatDraft.trim()) {
        const text = chatDraft.trim();
        chatLog.push({ name: "YOU", text, color });
        if (chatLog.length > CHAT_MAX) chatLog.shift();
        send({ type: "chat", text });
        chatDraft = "";
      }
    });

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
      UI.panel({ ...join, title: "ROAD RIVALS" }, () => {
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
      });
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
    if (gameState === "alive" && Mouse.inside && !OnscreenInput.visible(pad)) {
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
      game.setCursor("none");
    }
    OnscreenInput.drawControls(pad);
  },
});
