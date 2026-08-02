// A small multiplayer first-person shooter: a lobby browser, WASD + mouse look,
// hitscan fire, free-flying spectate, a Tab scoreboard, and a HUD drawn
// entirely with the ordinary minimotor UI.
//
// THE COMPOSITION, which is the point of this sample. Three ways exist to put
// 3D and the UI together, and this uses two of them, for two different jobs:
//
//   the HUD        `attachSceneLayer` — the GL canvas stacked UNDER the app's
//                  2D canvas, which stays transparent. The browser composites;
//                  there is no blit and no texture upload, and the HUD renders
//                  at native DPR. This is the right answer for a full-screen
//                  world with screen-space UI, and `UI.viewport3d` would be
//                  the wrong one: it would `drawImage` the whole screen every
//                  frame to put the scene BEHIND the UI, which stacking
//                  already does for free.
//   the terminal   `createUiSurface` — a real, clickable minimotor UI drawn
//                  onto a quad standing in the level. Use this when being IN
//                  the world is the point; a wall panel you walk up to and
//                  press is not a HUD. Its switches are SHARED: everyone in the
//                  room sees the lights change, because the terminal is backed
//                  by host-authoritative state rather than by two booleans.
//
// The third, `UI.viewport3d`, is absent because nothing here is a 3D view
// inside a panel. `samples/render3d` is the one that shows that.
//
// The networking lives in `netplay.ts`, which opens with the four decisions it
// makes and why. The short version: every player owns their own body, remote
// players are drawn ~90 ms in the past so they are always blended between two
// states that really happened, and the shooter decides the hit — which is
// lag-compensated for free, because what it tests against is exactly what was
// drawn. Read that header before changing anything here that touches `match`.
//
// The level is boxes, collision pushes a circle out of them, and firing is a
// ray/AABB test. It is a sample, not a shooter.
import { createUI, type Flow } from "minimotor/ui";
import { Buttons, createInput } from "minimotor/input";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createNet } from "minimotor/net";
import { createAudio } from "minimotor/audio";
import { Quat, Vec3, createApp } from "minimotor";
import {
  addNode,
  attachSceneLayer,
  box,
  cameraForward,
  cameraRight,
  createCamera,
  createRenderer3D,
  createUiSurface,
  cylinder,
  isWebGPUAvailable,
  look,
  node,
  placeEye,
  sphere,
  updateWorldMatrices,
  worldToScreen,
  type Backend3D,
  type Renderer3D,
  type SceneLayer,
} from "minimotor/3d";
import {
  EYE_HEIGHT,
  PLAYER_RADIUS,
  rayBox,
  resolve,
  revive,
  scene,
  solid,
  spawnFor,
  stepTargets,
  targets,
  wallDistance,
  type Box,
} from "./arena.js";
import {
  DEFAULT_DELAY_MS,
  MAX_HEALTH,
  joinMatch,
  openLobby,
  plausible,
  type Lobby,
  type Match,
  type MatchAd,
  type PlayerState,
  type RemotePlayer,
} from "./netplay.js";
import { atDistance, createSounds } from "./sound.js";

// No `background`: the engine then leaves the play area unpainted, so the 2D
// canvas stays transparent and the scene layer shows through it. Passing one
// here would hide the entire 3D world behind an opaque fill — the first thing
// to check if a scene layer renders black.
//
// `preventKeys` adds Tab to the engine's defaults. Tab is the scoreboard, and
// its untouched browser behaviour is to walk the focus ring off the canvas —
// after which the keyboard is driving the page, not the game.
const game = createApp("game", {
  preventKeys: ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"],
});
const view = game.viewport;
const { Draw, Keys, Loop, Pointer } = game;
const Input = createInput(game);
const UI = createUI(game, Input);
const OnscreenInput = createOnscreenInput(game, Input, UI);
const Net = createNet(game);
const Audio = createAudio(game);
const sfx = createSounds(Audio);

/** The well-known room every client meets in. Not a server feature — see
 *  `netplay.ts` §1. */
const LOBBY_ROOM = "fps-lobby";

// ---- touch controls --------------------------------------------------------
// A twin-stick pad, which is what a first-person game is on a touchscreen: the
// left stick walks, the right one LOOKS. Autohidden on desktop, so it costs a
// mouse-and-keyboard player nothing; `merge` also fuses a real hardware pad
// into the same axes, so the code below is one path for touch, gamepad and the
// on-screen controls at once.
const pad = OnscreenInput.gamepad({
  opacity: 0.5,
  stick: { anchor: { side: "left", x: 96, y: 100 }, radius: 62 },
  rightStick: { anchor: { side: "right", x: 96, y: 100 }, radius: 62 },
  buttons: [
    { anchor: { side: "right", x: 210, y: 176 }, r: 40, button: "a", label: "FIRE" },
    { anchor: { side: "right", x: 240, y: 78 }, r: 30, button: "b", label: "RELOAD" },
    { anchor: { side: "left", x: 210, y: 176 }, r: 30, button: "x", label: "RUN" },
    // Unmapped: a pause button has no business pretending to be a face button,
    // and `onTap` is the hook for exactly that. Anchors are always measured up
    // from the BOTTOM, so "out of the way" here means high above the left
    // stick rather than in a top corner.
    { anchor: { side: "left", x: 60, y: 250 }, r: 24, label: "II", onTap: () => (paused = true) },
    {
      anchor: { side: "right", x: 60, y: 250 },
      r: 24,
      label: "TAB",
      onTap: () => (boardPin = !boardPin),
    },
  ],
});

// ---- the in-world terminal -------------------------------------------------
// A real minimotor UI on a quad, standing in the level. Walk up to it and
// click: the buttons hover and press exactly as they do on the HUD, because
// they ARE the same widgets. Only the pointer's POSITION is re-derived, by
// casting its ray at the quad; the press and release edges are the real
// device's.

const TERMINAL_POS = { x: 0, y: 1.9, z: -13.4 };
const TERMINAL_PX_W = 260;
const TERMINAL_PX_H = 210;
const TERMINAL_WORLD_W = 2.2;
const terminal = createUiSurface({
  // Required here and not in `samples/render3d`: that one draws its surface
  // from inside a `UI.viewport3d` callback, which has already selected the app.
  // This one draws straight from `Loop.draw`, so the surface has to be told.
  app: game,
  width: TERMINAL_PX_W,
  height: TERMINAL_PX_H,
  worldWidth: TERMINAL_WORLD_W,
  background: "rgba(10,14,24,0.92)",
});
const terminalNode = addNode(
  scene,
  node({
    name: "terminal",
    mesh: terminal.mesh,
    material: terminal.material,
    position: TERMINAL_POS,
  }),
);
// A frame behind it, so it reads as a fixture rather than a floating decal.
addNode(
  scene,
  node({
    mesh: box(2.5, 1.95, 0.12),
    position: { x: TERMINAL_POS.x, y: TERMINAL_POS.y, z: TERMINAL_POS.z - 0.1 },
    material: { color: [0.16, 0.18, 0.24, 1], shininess: 30, specular: 0.15 },
  }),
);
// And a plinth in front of it. This is not decoration: the quad has no
// collider, so without something to stop you the player walks up to it until
// the panel fills the whole screen at two pixels per glyph. The plinth holds
// you at a reading distance, which is also the distance the ray cast is most
// accurate at.
solid(
  { x: TERMINAL_POS.x, y: 0.5, z: TERMINAL_POS.z + 2, hx: 1.4, hy: 0.5, hz: 0.5 },
  [0.18, 0.2, 0.26, 1],
);

// ---- remote player avatars -------------------------------------------------
// A fixed pool, assigned to whoever is present this frame. Growing the scene's
// node array as players come and go would work, but nodes are never removed
// from a `Scene3D` (indices are handles), so a long session would leak one
// avatar per join.

const MAX_AVATARS = 8;

interface Avatar {
  pivot: number;
  head: number;
  /** Recoloured per seat the first time it is handed out. */
  seat: number;
}

const avatars: Avatar[] = [];
for (let i = 0; i < MAX_AVATARS; i++) {
  const pivot = addNode(scene, node({ name: `avatar-${i}`, hidden: true }));
  addNode(
    scene,
    node({
      parent: pivot,
      mesh: cylinder(0.32, 1.2, 12),
      position: { x: 0, y: -0.35, z: 0 },
      material: { color: [0.6, 0.6, 0.7, 1], shininess: 20, specular: 0.15 },
    }),
  );
  const head = addNode(
    scene,
    node({
      parent: pivot,
      mesh: sphere(0.26, 16, 12),
      position: { x: 0, y: 0.45, z: 0 },
      material: { color: [0.9, 0.9, 0.95, 1], shininess: 60, specular: 0.4 },
    }),
  );
  // A stub barrel, so which way someone is facing is readable at range. Local
  // −Z is forward, matching the camera convention.
  addNode(
    scene,
    node({
      parent: pivot,
      mesh: box(0.1, 0.1, 0.7),
      position: { x: 0.2, y: 0.15, z: -0.45 },
      material: { color: [0.2, 0.21, 0.26, 1] },
    }),
  );
  avatars.push({ pivot, head, seat: -1 });
}

/** The hue `Net.playerColor` assigns a seat: the golden angle, so neighbouring
 *  slots never look alike. Repeated here because the avatar needs the number,
 *  not the CSS string. */
const seatHue = (index: number): number => (index * 137.508 + 320) % 360;

/** The seat colour as CSS, with an alpha the nameplates fade on. */
function seatCss(index: number, alpha: number): string {
  return `hsla(${seatHue(index).toFixed(1)}, 90%, 65%, ${alpha.toFixed(3)})`;
}

/** The same colour as the renderer wants it: `[r, g, b, a]` in 0..1. */
function seatRgb(index: number): [number, number, number, number] {
  const hue = seatHue(index) / 60;
  const c = 0.62;
  const x = c * (1 - Math.abs((hue % 2) - 1));
  const [r, g, b] =
    hue < 1
      ? [c, x, 0]
      : hue < 2
        ? [x, c, 0]
        : hue < 3
          ? [0, c, x]
          : hue < 4
            ? [0, x, c]
            : hue < 5
              ? [x, 0, c]
              : [c, 0, x];
  const m = 0.28;
  return [r + m, g + m, b + m, 1];
}

// ---- the viewmodel ---------------------------------------------------------
// A real gun in the scene rather than a rectangle on the HUD, because the thing
// that has to be in the right place is the MUZZLE — and the only way for a
// screen-space flash to sit on the end of a barrel is to guess at where the
// barrel projects to. Modelling it means the flash is simply a child of the
// barrel: correct at every FOV, every aspect ratio and every recoil offset,
// with no projection anywhere.
//
// Everything hangs off `gunPivot`, which is placed at the EYE each frame with
// the camera's own orientation, so the children are authored in a comfortable
// local frame: +x right, +y up, −z forward, the same convention as the camera.

const GUN_METAL: readonly [number, number, number, number] = [0.17, 0.18, 0.22, 1];
const GUN_DARK: readonly [number, number, number, number] = [0.1, 0.11, 0.14, 1];

const gunPivot = addNode(scene, node({ name: "viewmodel" }));
/** The parts that recoil together — everything except the pivot, so the kick is
 *  one node's position rather than six. */
const gunBody = addNode(scene, node({ parent: gunPivot }));

const gunPart = (
  mesh: ReturnType<typeof box>,
  x: number,
  y: number,
  z: number,
  color: readonly [number, number, number, number],
) =>
  addNode(
    scene,
    node({
      parent: gunBody,
      mesh,
      position: { x, y, z },
      material: { color, shininess: 40, specular: 0.2 },
    }),
  );

// HOW FAR OUT the gun sits is the whole tuning problem, and it is a
// consequence of the FOV rather than of the model. A real shooter renders its
// viewmodel in a SECOND pass with its own narrow FOV, precisely so the two can
// be tuned apart; in one pass, at the 91° this game plays at, an object held
// 0.35 m from the eye subtends about a third of the screen — the first version
// of this gun was a grey wedge across the bottom-right quadrant.
//
// So it is held out at arm's length instead: ~0.7 m to the receiver, ~1.2 m to
// the muzzle. That lands it in the bottom-right corner at a believable size and
// costs one thing, which is worth knowing about — a barrel that long pokes
// through a wall the player is pressed against, because the collision radius is
// only 0.35 m. A second pass is the cure if that ever matters.
gunPart(box(0.075, 0.09, 0.32), 0.26, -0.235, -0.78, GUN_METAL);
gunPart(box(0.042, 0.042, 0.32), 0.26, -0.2, -1.1, GUN_DARK);
gunPart(box(0.065, 0.14, 0.07), 0.26, -0.33, -0.66, GUN_DARK);
gunPart(box(0.048, 0.11, 0.04), 0.26, -0.33, -0.78, GUN_METAL);
gunPart(box(0.015, 0.038, 0.015), 0.26, -0.155, -1.2, GUN_METAL);

/** Where the barrel ends, in the gun's local frame. The flash hangs off this,
 *  so there is one number to change. */
const MUZZLE_LOCAL = { x: 0.26, y: -0.2, z: -1.32 };

// The flash: unlit so it reads as light rather than as a lit yellow box, and
// transparent so it fades out instead of popping. Two crossed cards would be
// the next refinement; a box is enough at the size it is on screen.
// The alpha is mutated in place rather than by assigning a fresh material each
// frame: materials are the renderer's cache key, and handing it a new object 60
// times a second is how you make a fade allocate.
const flashColor: [number, number, number, number] = [1, 0.85, 0.45, 1];
const muzzleNode = addNode(
  scene,
  node({
    parent: gunBody,
    // A sphere, not a box: unlit means every face is the same flat colour, so
    // a cube at this size reads as a clipped yellow rectangle rather than as
    // light. Stretched along the barrel below, it becomes a teardrop.
    mesh: sphere(0.05, 10, 7),
    position: MUZZLE_LOCAL,
    material: { color: flashColor, unlit: true, transparent: true },
    hidden: true,
  }),
);

const qYaw = Quat.create();
const qPitch = Quat.create();

/** Put the viewmodel where the camera is, and apply the recoil. Called from
 *  DRAW, so the kick is smooth at the display's rate rather than the step's. */
function placeViewmodel(): void {
  const pivot = scene.nodes[gunPivot];
  // Hidden while there is no body to hold it: a spectator flying through walls
  // with a rifle floating in front of them is not the look.
  const armed = phase === "match" && deployed && respawnIn === 0;
  pivot.hidden = !armed;
  if (!armed) return;
  pivot.position.x = player.x;
  pivot.position.y = player.y;
  pivot.position.z = player.z;
  // Yaw about +Y then pitch about −X: that composition maps local −Z onto
  // `cameraForward` exactly, which is what makes the barrel point where the
  // crosshair does.
  Quat.fromAxisAngle(qYaw, 0, 1, 0, camera.yaw);
  Quat.fromAxisAngle(qPitch, 1, 0, 0, -camera.pitch);
  Quat.mul(qYaw, qPitch, pivot.rotation);

  // Kick straight back and a little down, so the muzzle rises on screen.
  const kick = recoil * recoil;
  const bodyNode = scene.nodes[gunBody];
  bodyNode.position.z = kick * 0.05;
  bodyNode.position.y = -kick * 0.012;

  const flash = scene.nodes[muzzleNode];
  flash.hidden = muzzle <= 0;
  if (!flash.hidden) {
    // Grows along the barrel as it fades, which reads as a burst rather than as
    // a box being switched off.
    const s = 0.6 + muzzle * 0.7;
    Vec3.set(flash.scale, s, s, 0.7 + muzzle * 1.4);
    flashColor[3] = Math.min(1, muzzle * 1.2);
  }
}

// ---- player ----------------------------------------------------------------

// `fov` is VERTICAL, and on a 16:9 screen 60° vertical is about 91° across —
// the usual shooter figure. Quoting the horizontal number instead is where the
// fish-eye comes from: 75° vertical is 110° horizontal, and a sphere near the
// edge of that stretches into an egg.
const camera = createCamera({ fov: Math.PI / 3, near: 0.08, far: 80, yaw: 0, pitch: 0 });
/** `look`'s own default, named so the sensitivity slider is a multiplier on a
 *  stated baseline rather than a magic number of its own. */
const LOOK_BASE = 0.0022;
const player: Vec3 = { x: 0, y: EYE_HEIGHT, z: 8 };
const velocity: Vec3 = { x: 0, y: 0, z: 0 };

const MAG = 12;
const RELOAD_TIME = 1.1;
/** Seconds between shots while the trigger is held — ~430 rpm. */
const FIRE_INTERVAL = 0.14;
let fireCooldown = 0;
let dryCooldown = 0;
/** Distance walked since the last footfall, in metres. */
let stepDistance = 0;
let ammo = MAG;
let reloading = 0;
let score = 0;
let shots = 0;
let hits = 0;
let recoil = 0;
let hitMarker = 0;
let muzzle = 0;
let damageFlash = 0;
let message = "";
let messageAge = 99;
/** The Esc menu is open. While it is, the world is frozen and the UI has the
 *  pointer. */
let paused = false;
/** Held-Tab scoreboard, and the touch button's latch for the same thing. */
let boardPin = false;

/** What everyone else receives. Rewritten in place each step and sampled by the
 *  share at 20 Hz — see `netplay.ts` for the shape and why it is not packed. */
const me: PlayerState = {
  x: player.x,
  y: player.y,
  z: player.z,
  vx: 0,
  vz: 0,
  yaw: 0,
  pitch: 0,
  live: 0,
  hp: MAX_HEALTH,
  kills: 0,
  deaths: 0,
  name: "",
};

/** Seconds until we come back. 0 while alive. */
let respawnIn = 0;
/** Who put us here, for the death message. */
let killedBy = "";

// ---- settings --------------------------------------------------------------
// Every one of these is a live knob on something the engine already exposes, so
// the menu is a tour of the API rather than a screenshot of one: the FOV is the
// camera's, the render scale is the scene layer's, the interpolation delay is
// the snapshot buffer's, and the backend is the whole renderer being rebuilt
// underneath a running game.

const settings = {
  /** HORIZONTAL field of view in degrees — the number players know. The camera
   *  stores the vertical one, which depends on the aspect ratio, so a menu that
   *  showed it would move on its own when the window is resized. */
  fovX: 91,
  /** Multiplier on `look`'s default sensitivity. */
  sensitivity: 1,
  /** Fraction of the display resolution the WORLD renders at. The HUD is on
   *  the other canvas and stays sharp whatever this says. */
  renderScale: 1,
  invertY: false,
  /** Master output, 0..1. Applied to `Audio.master`, which reaches every bus
   *  this app owns and nothing another app on the page owns. */
  volume: 0.8,
  showStats: false,
  showNet: false,
  /** How far in the past remote players are drawn. Read when a match is joined;
   *  the label says so, because a slider that silently does nothing is worse
   *  than one that explains itself. */
  interpDelayMs: DEFAULT_DELAY_MS,
};

// ---- names -----------------------------------------------------------------
// `Player 47` is a placeholder pretending to be a name, and in a scoreboard of
// them nobody can tell who shot them. Two words from two lists gives ~2600
// combinations, which is plenty for a room of eight and short enough to fit a
// nameplate at range — the constraint that ruled out anything longer.

const CALLSIGN_FIRST = [
  "Rusty",
  "Feral",
  "Velvet",
  "Grim",
  "Turbo",
  "Neon",
  "Salty",
  "Radiant",
  "Cosmic",
  "Wired",
  "Hollow",
  "Brisk",
  "Molten",
  "Silent",
  "Crooked",
  "Vivid",
  "Frosty",
  "Ragged",
  "Lucky",
  "Sombre",
  "Jagged",
  "Placid",
  "Static",
  "Copper",
  "Wayward",
  "Humble",
  "Restless",
  "Gilded",
  "Blunt",
  "Nimble",
  "Weary",
  "Bold",
  "Wicked",
  "Prime",
  "Hushed",
  "Zesty",
  "Bitter",
  "Stray",
  "Prompt",
  "Woolly",
];

const CALLSIGN_SECOND = [
  "Otter",
  "Pylon",
  "Comet",
  "Wrench",
  "Magpie",
  "Signal",
  "Kettle",
  "Falcon",
  "Bramble",
  "Sprocket",
  "Heron",
  "Anvil",
  "Pixel",
  "Marmot",
  "Beacon",
  "Thistle",
  "Cobra",
  "Lantern",
  "Badger",
  "Piston",
  "Nettle",
  "Vulture",
  "Gasket",
  "Puffin",
  "Compass",
  "Walrus",
  "Turbine",
  "Ferret",
  "Harpoon",
  "Gannet",
  "Bobcat",
  "Kraken",
  "Rivet",
  "Osprey",
  "Hornet",
  "Quasar",
  "Dingo",
  "Mantis",
  "Griffin",
  "Ember",
  "Weasel",
  "Cutlass",
  "Narwhal",
  "Bishop",
  "Talon",
  "Cinder",
  "Jackal",
  "Sable",
  "Wombat",
  "Cyclone",
  "Raven",
  "Bandit",
  "Locust",
  "Tundra",
  "Viper",
  "Pelican",
  "Gecko",
  "Meteor",
  "Shrike",
  "Basalt",
  "Wolfhound",
  "Corvid",
  "Onyx",
  "Stoat",
];

const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

/** A two-word callsign. Occasionally numbered, because a squad with a Cobra and
 *  a Cobra-2 in it reads as a real roster rather than a word generator. */
function randomName(): string {
  const name = `${pick(CALLSIGN_FIRST)} ${pick(CALLSIGN_SECOND)}`;
  return Math.random() < 0.12 ? `${name}-${2 + Math.floor(Math.random() * 8)}` : name;
}

let playerName = randomName();

// ---- session ---------------------------------------------------------------
// Three phases and one flag. `deployed` is the spectate/play split: a player in
// a match who has not deployed flies through the level with no body, is not
// shootable, and cannot shoot.

type Phase = "connecting" | "lobby" | "joining" | "match";
let phase: Phase = "connecting";
let lobby: Lobby | null = null;
let match: Match | null = null;
/** We are the one advertising this match, so we hold the lobby room open. */
let advertising = false;
let deployed = false;
let joinError: string | null = null;
let codeField = "";
/** Last `resetCount` we acted on, so a host's reset reaches every client
 *  exactly once — including one that joined after it happened. */
let seenResetCount = 0;

void (async () => {
  lobby = await openLobby(Net, LOBBY_ROOM);
  if (phase === "connecting") phase = "lobby";
})();

function newCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase();
}

async function enterMatch(code: string, host: boolean): Promise<void> {
  if (phase === "joining") return;
  phase = "joining";
  joinError = null;
  try {
    match = await joinMatch(Net, {
      code,
      name: playerName,
      local: () => me,
      delayMs: () => settings.interpDelayMs,
      onHit: (from, dmg) => {
        if (!deployed || respawnIn > 0) return;
        // Advisory in a peer mesh, and `netplay.ts` says why — but this is the
        // line that moves to the server in a client/server build, so it is
        // written down rather than assumed.
        if (
          !plausible(
            player,
            match?.others.find((o) => o.id === from),
          )
        )
          return;
        me.hp = Math.max(0, me.hp - dmg);
        damageFlash = 1;
        // Lower as it gets worse — the pitch IS the health bar, for a player
        // who is looking at the crosshair rather than the corner.
        sfx.hurt.play({ pitch: 0.85 + (me.hp / MAX_HEALTH) * 0.3 });
        if (me.hp === 0) die(from);
      },
      onDeath: (who, by) => {
        if (by === me_id() && who !== me_id()) {
          me.kills++;
          score += 250;
          // A frag confirm is the hit confirm, a fifth lower and twice as long.
          sfx.hitTarget.play({ pitch: 0.8, stretch: 1.4 });
          say("FRAG  +250");
        }
      },
      onRemoteShot: (distance) => {
        const volume = atDistance(distance, 0.9);
        // Out of earshot is skipped, not played at zero — a busy room would
        // otherwise book a voice per shot per player for nothing.
        if (volume > 0) sfx.shotFar.play({ volume, pitch: [0.9, 1.1] });
      },
    });
    advertising = host;
    seenResetCount = match.world.resetCount;
    sfx.join.play();
    // Spectate first, always: dropping straight into a body means spawning
    // before the level has even been seen. The prompt to deploy is on the HUD.
    deployed = false;
    me.live = 0;
    me.hp = MAX_HEALTH;
    me.name = playerName;
    if (!host) {
      // A guest has no reason to stay in the lobby mesh — see `netplay.ts` §1.
      lobby?.close();
      lobby = null;
    }
    phase = "match";
  } catch (err: unknown) {
    joinError = err instanceof Error ? err.message : String(err);
    phase = "lobby";
  }
}

/** Our room id, or a stable placeholder before a match exists. */
function me_id(): string {
  return match?.net.id ?? "";
}

function leaveMatch(): void {
  sfx.leave.play();
  match?.close();
  match = null;
  advertising = false;
  deployed = false;
  paused = false;
  phase = lobby ? "lobby" : "connecting";
  if (!lobby) {
    void (async () => {
      lobby = await openLobby(Net, LOBBY_ROOM);
      if (phase === "connecting") phase = "lobby";
    })();
  }
}

function deploy(): void {
  const spawn = spawnFor(match?.net.index ?? 0);
  player.x = spawn.x;
  player.z = spawn.z;
  player.y = EYE_HEIGHT;
  Vec3.set(velocity, 0, 0, 0);
  camera.yaw = spawn.yaw;
  camera.pitch = 0;
  deployed = true;
  me.live = 1;
  me.hp = MAX_HEALTH;
  ammo = MAG;
  reloading = 0;
  respawnIn = 0;
  stepDistance = 0;
  match?.reportSpawn();
  sfx.spawn.play();
  say("DEPLOYED");
}

function die(by: string): void {
  me.deaths++;
  me.live = 0;
  killedBy = nameOf(by);
  respawnIn = 2.5;
  match?.reportDeath(by);
  sfx.death.play();
  say(`KILLED BY ${killedBy.toUpperCase()}`);
}

function nameOf(id: string): string {
  if (id === me_id()) return playerName;
  const other = match?.others.find((o) => o.id === id);
  return other?.name || `P${(other?.index ?? 0) + 1}`;
}

// ---- mouse look ------------------------------------------------------------
// Pointer lock gives movementX/Y DELTAS, which the engine's polled `Pointer`
// deliberately does not model — it reports a position, and a locked pointer has
// none. So this sample owns the listener. If a second game ever needs it, this
// is the shape that would move into `src/input`.

let lockDx = 0;
let lockDy = 0;
let locked = false;
let lockRefused = false;

/** The mouse belongs to the game only while a match is on screen and no menu
 *  is up. In the lobby it belongs to the browser's own widgets. */
function wantsLock(): boolean {
  return phase === "match" && !paused && !document.hidden;
}

/** Whether the lock has ever been granted, which is what separates "this
 *  browser will not do it" from "not yet". */
let lockedEver = false;

/** A request is in flight. The retry below runs every step, and firing a second
 *  request before the first settles is how a grant ends up arriving long after
 *  the player has moved on. */
let lockPending = false;

/** Ask for the pointer lock. MUST be called from a user gesture — see
 *  `resume` for what happens when it is not. */
function grabPointer(): void {
  if (locked || lockPending || !wantsLock()) return;
  // Chrome returns a promise that REJECTS when the lock is refused; unhandled,
  // that is also a console error on every click. Safari returns undefined,
  // hence the guard.
  const p: unknown = game.canvas.requestPointerLock();
  // Safari returns undefined and locks synchronously off the gesture, so there
  // is nothing to await and nothing to guard against.
  if (!(p instanceof Promise)) return;
  lockPending = true;
  p.then(
    () => {
      lockedEver = true;
      lockPending = false;
    },
    () => {
      lockPending = false;
      // Only cry wolf when it has never worked. A refusal on a page that was
      // locked a moment ago is not a browser that refuses locks.
      if (!lockedEver) lockRefused = true;
    },
  );
}

game.canvas.addEventListener("click", () => {
  // A browser will not start an AudioContext without a gesture, and this is the
  // first one the page ever gets. Doing it here rather than at the first
  // `play()` is the difference between "the gun is silent for one shot" and
  // "the gun has always had a sound".
  Audio.ensureAudio();
  // While the menu is open the pointer belongs to the UI: re-locking on the
  // click that pressed "Invert Y" would shut the menu the player is using.
  grabPointer();
});

/** When the menu was opened by the lock being lost. Escape's own keydown can
 *  arrive in the SAME step, and without this it would immediately close the
 *  menu it just opened — the "sometimes it does not pause" half of the bug. */
let menuOpenedAt = -1e9;

/** When the lock was lost during a match, with the reason not yet decided;
 *  −1 when there is nothing pending. Resolved in `update`. */
let lockLostAt = -1;
/** How long to wait before ruling on why the lock was lost. Long enough for a
 *  focus or visibility change to land, short enough not to read as lag. */
const PAUSE_DECISION_MS = 150;

document.addEventListener("pointerlockchange", () => {
  const was = locked;
  locked = document.pointerLockElement === game.canvas;

  if (locked) {
    // A grant can land AFTER the player has paused again — the request was
    // already in flight. Taking it would leave the menu up with the mouse
    // captured, and the next Esc would then "reopen" a menu that never closed.
    if (paused) document.exitPointerLock();
    return;
  }
  if (!was || phase !== "match") return;
  // Esc is the browser's own way out of a pointer lock and the keydown is not
  // delivered, so the LOSS of the lock is USUALLY the Esc press. But switching
  // tabs and alt-tabbing drop it too, and coming back to a pause menu you never
  // asked for is worse than coming back to a game that just wants its mouse.
  //
  // Which one it was CANNOT be known here: the events that would say so can
  // arrive after this one. So only note the time, and let `update` rule on it.
  lockLostAt = performance.now();
});
document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  // Accumulated, not assigned: several mousemove events can arrive between two
  // fixed steps, and keeping only the last one loses most of a fast flick.
  lockDx += e.movementX;
  lockDy += e.movementY;
});

// ---- shooting --------------------------------------------------------------

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };
const wish: Vec3 = { x: 0, y: 0, z: 0 };

function say(text: string): void {
  message = text;
  messageAge = 0;
}

/** The reload, as four things happening at four times rather than one sound
 *  played once. Seconds from the start of a `RELOAD_TIME` reload; the last one
 *  lands just before the magazine is actually usable, which is what makes the
 *  bolt feel like the thing that finished it. */
const RELOAD_STAGES: readonly { at: number; play: () => void }[] = [
  { at: 0, play: () => sfx.magOut.play({ pitch: [0.96, 1.05] }) },
  { at: 0.24, play: () => sfx.magDrop.play({ pitch: [0.9, 1.12], stretch: [0.9, 1.15] }) },
  { at: 0.62, play: () => sfx.magIn.play({ pitch: [0.96, 1.04] }) },
  { at: 0.88, play: () => sfx.boltRack.play({ pitch: [0.97, 1.06] }) },
];
/** How many stages have fired for the reload in progress. */
let reloadStage = 0;

function reload(): void {
  if (reloading > 0 || ammo === MAG) return;
  reloading = RELOAD_TIME;
  reloadStage = 0;
}

function fire(): void {
  if (!deployed || respawnIn > 0) return;
  if (reloading > 0 || ammo <= 0) {
    // The trigger still moves on an empty chamber, and hearing that is how a
    // player learns they are out without reading the HUD. On its own timer,
    // though: the trigger repeats seven times a second and a dry click at that
    // rate is a machine gun made of disappointment.
    if (dryCooldown <= 0) {
      sfx.dry.play({ pitch: [0.94, 1.06] });
      dryCooldown = 0.45;
    }
    return;
  }
  ammo--;
  shots++;
  recoil = 1;
  muzzle = 1;
  // Jittered on both axes: eleven identical shots in a magazine is the tell
  // that gives synthesized audio away.
  sfx.shot.play({ pitch: [0.93, 1.07], stretch: [0.92, 1.1] });
  cameraForward(camera, forward);

  // Players first, through the shared layer — it owns the lag compensation, so
  // this file must not second-guess which positions to test.
  const playerId = match?.shoot(player, forward) ?? null;
  if (playerId) {
    hits++;
    hitMarker = 1;
    sfx.hitPlayer.play();
    say(`HIT ${nameOf(playerId).toUpperCase()}`);
    return;
  }

  // Then the gallery. Nearest target, but only if no wall is nearer —
  // otherwise you shoot through cover, which is the bug every first hitscan
  // has.
  let bestT = wallDistance(player, forward);
  let bestTarget: (typeof targets)[number] | null = null;
  for (const t of targets) {
    if (!t.alive) continue;
    const d = rayBox(player, forward, t.box);
    if (d < bestT) {
      bestT = d;
      bestTarget = t;
    }
  }
  if (bestTarget) {
    bestTarget.alive = false;
    bestTarget.dying = 1e-6;
    hits++;
    score += 100;
    hitMarker = 1;
    sfx.hitTarget.play();
    say("TARGET DOWN  +100");
  }
}

// ---- renderer --------------------------------------------------------------

let renderer: Renderer3D | null = null;
let layer: SceneLayer | null = null;
let rendererError: string | null = null;
let switching = false;
// Synchronous, and only proves `navigator.gpu` exists — enough to decide
// whether OFFERING the button is honest. Whether an adapter can actually be
// acquired is what `useBackend` finds out.
const webgpuOk = isWebGPUAvailable();

/** Build a renderer on `want` and put it under the HUD. The old one is detached
 *  and disposed only AFTER the new one exists, so a switch that fails leaves
 *  the game running on the backend it already had instead of on nothing. */
async function useBackend(want: Backend3D | "auto"): Promise<void> {
  if (switching) return;
  switching = true;
  const prevRenderer = renderer;
  const prevLayer = layer;
  try {
    const next = await createRenderer3D({ antialias: true, backend: want });
    prevLayer?.detach();
    prevRenderer?.dispose();
    renderer = next;
    layer = attachSceneLayer(game, next, { resolutionScale: settings.renderScale });
    rendererError = null;
  } catch (err: unknown) {
    rendererError = err instanceof Error ? err.message : String(err);
  } finally {
    switching = false;
  }
}

void useBackend("auto");

// ---- frame -----------------------------------------------------------------

/** In reach of the terminal — near enough to operate it. Drives the prompt and
 *  whether the surface gets a pointer at all. */
let terminalNear = false;
/** In reach AND the crosshair is on the panel. This, not `terminalNear`, is
 *  what swallows a shot: being close to the terminal should not disarm you, it
 *  should only stop you shooting the terminal ITSELF. */
let aimingAtTerminal = false;
/** The panel as a collision box. The quad is axis-aligned and faces +Z, so a
 *  thin AABB is exact rather than an approximation; the height comes from the
 *  surface's own pixel aspect, so resizing the terminal cannot desync it. */
const TERMINAL_BOX: Box = {
  x: TERMINAL_POS.x,
  y: TERMINAL_POS.y,
  z: TERMINAL_POS.z,
  hx: TERMINAL_WORLD_W / 2,
  hy: (TERMINAL_WORLD_W * (TERMINAL_PX_H / TERMINAL_PX_W)) / 2,
  hz: 0.08,
};
/** Scratch for the aim ray — `forward` is flattened for walking by then. */
const aimDir: Vec3 = { x: 0, y: 0, z: 0 };
/** Lobby camera angle: the arena is the lobby's backdrop, seen from above. */
let lobbyOrbit = 0;

Loop.run({
  update() {
    const dt = Loop.step / 1000;

    // Applied BEFORE the pause gate, and every step: these are the knobs the
    // pause menu owns, and a FOV slider you can only judge after closing the
    // menu is a FOV slider you are tuning blind.
    camera.fov = verticalFov(settings.fovX);
    if (layer && layer.resolutionScale !== settings.renderScale) {
      layer.setResolutionScale(settings.renderScale);
    }
    if (Audio.master.volume !== settings.volume) Audio.master.volume = settings.volume;
    stepTargets(dt);
    dryCooldown = Math.max(0, dryCooldown - dt);
    // Rule on a lock that was lost a moment ago (see the `pointerlockchange`
    // handler). The question that separates Esc from leaving is not "is the tab
    // hidden" — alt-tabbing to another APPLICATION leaves the tab visible and
    // fires no `visibilitychange` at all, which is why watching that event
    // alone still popped the menu. `hasFocus` covers both, and asking a beat
    // late means it has settled whichever order the events arrived in.
    if (lockLostAt >= 0) {
      if (document.hidden || !document.hasFocus() || phase !== "match") {
        lockLostAt = -1;
      } else if (performance.now() - lockLostAt >= PAUSE_DECISION_MS) {
        lockLostAt = -1;
        paused = true;
        menuOpenedAt = performance.now();
      }
    }
    recoil = Math.max(0, recoil - dt * 5);
    muzzle = Math.max(0, muzzle - dt * 12);
    hitMarker = Math.max(0, hitMarker - dt * 2.5);
    damageFlash = Math.max(0, damageFlash - dt * 2);
    messageAge += dt;

    if (phase !== "match") {
      lobbyStep(dt);
      return;
    }

    // Esc while unlocked closes the menu; taking the mouse back needs a click
    // the browser will accept, which `resume` explains.
    // While LOCKED the browser eats the keydown to release the pointer, and
    // `pointerlockchange` opens the menu instead — two paths because there are
    // genuinely two situations.
    if (Keys.pressed("Escape") && !locked) {
      // Not within a few frames of the lock being lost: that same Esc is what
      // released it, and the release already opened the menu.
      if (!paused) {
        paused = true;
        menuOpenedAt = performance.now();
      } else if (performance.now() - menuOpenedAt > 250) {
        resume();
      }
    }

    if (advertising && lobby && match) {
      lobby.advertise({
        code: match.code,
        title: `${playerName}'s arena`,
        players: match.net.count,
        max: MAX_AVATARS,
        since: match.net.now,
      });
    }

    // The shared switches. Read every step rather than on an event, so a client
    // that joined after the change still lands on the right lighting.
    const world = match!.world;
    scene.lights[1].intensity = world.fill ? 0.5 : 0;
    scene.ambient = world.ambient ? [0.22, 0.24, 0.32] : [0.08, 0.09, 0.13];
    if (world.resetCount !== seenResetCount) {
      seenResetCount = world.resetCount;
      for (const t of targets) revive(t);
      say("TARGETS RESET");
    }

    if (paused) {
      lockDx = 0;
      lockDy = 0;
      publish();
      return;
    }

    lookStep(dt);
    moveStep(dt);

    if (deployed && respawnIn === 0) {
      if (Keys.pressed("KeyR") || pad.pressed(Buttons.B)) reload();
      if (reloading > 0) {
        reloading -= dt;
        // Fire every stage the elapsed time has passed. A `while` rather than
        // an `if` because a long frame can step over two of them, and a bolt
        // that never racked because the tab stuttered is a reload that sounds
        // unfinished.
        const elapsed = RELOAD_TIME - Math.max(0, reloading);
        while (reloadStage < RELOAD_STAGES.length && elapsed >= RELOAD_STAGES[reloadStage].at) {
          RELOAD_STAGES[reloadStage++].play();
        }
        if (reloading <= 0) {
          reloading = 0;
          ammo = MAG;
          say("RELOADED");
        }
      }
      terminalNear = Math.hypot(player.x - TERMINAL_POS.x, player.z - TERMINAL_POS.z) < 4.5;
      // A fresh ray: `forward` has been flattened for walking by now, and an
      // aim test on a horizontal vector would claim you are pointing at the
      // panel whenever you are level with it, whatever you are looking at.
      cameraForward(camera, aimDir);
      aimingAtTerminal = terminalNear && rayBox(player, aimDir, TERMINAL_BOX) < Infinity;

      // HELD, not pressed, and rate-limited. Three reasons, and the first one
      // is a trap worth naming:
      //
      //   `Pointer.framePressed` is the DRAW-phase counterpart of
      //   `Pointer.pressed` — it is cleared at frame end whether or not an
      //   update step ran that frame. Reading it from `update`, as this did,
      //   silently drops clicks: with a 60 Hz step on a 144 Hz display most
      //   frames run zero steps, so most presses are cleared before any step
      //   observes them. `pressed` is the one that survives a stepless frame,
      //   and a LEVEL signal survives regardless.
      //
      //   `pad.down` was already level, so the touch FIRE button emptied the
      //   magazine in a fifth of a second.
      //
      //   And an arena shooter wants a fire rate anyway.
      //
      // A click belongs to the terminal only when the crosshair is actually ON
      // it. Gating on PROXIMITY instead — which this did — disarms the player
      // for a 4.5 m circle around the panel, so a fight that drifts into that
      // corner is one you cannot shoot back in.
      //
      // Only the CLICK is gated, because only the click is overloaded: it both
      // fires and presses the panel's buttons. F and the pad's FIRE button mean
      // one thing each, so they shoot whatever you are pointing at, terminal
      // included.
      // F, not Space: clicking the terminal gives one of its widgets keyboard
      // focus, and Space/Enter is how the UI activates a focused widget. Bind
      // fire to Space and every shot also presses whatever button the player
      // last touched.
      fireCooldown -= dt;
      const holdingFire =
        ((Pointer.down || Pointer.pressed) && locked && !aimingAtTerminal) ||
        Keys.down("KeyF") ||
        pad.down(Buttons.A);
      if (holdingFire && fireCooldown <= 0) {
        fire();
        fireCooldown = FIRE_INTERVAL;
      }
      if (ammo === 0 && reloading === 0) reload();
    } else {
      terminalNear = false;
      aimingAtTerminal = false;
      // Deploy from spectate. Enter and the fire button both do it, because
      // "press to join" should work with whatever the player already has a
      // finger on.
      const asked = Keys.pressed("Enter") || Keys.pressed("Space") || pad.pressed(Buttons.A);
      if (respawnIn > 0) {
        respawnIn -= dt;
        if (respawnIn <= 0) {
          respawnIn = 0;
          deploy();
        }
      } else if (asked) {
        deploy();
      }
    }

    publish();
  },

  draw() {
    // With no `background` the engine leaves clearing to us — which is exactly
    // what a scene layer needs, but it means the HUD has to erase itself or
    // last frame's text stays on the glass forever.
    game.ctx.clearRect(0, 0, view.w, view.h);

    if (!renderer) {
      UI.text("starting the GPU…", { x: 0, y: view.h / 2, w: view.w, align: "center" });
      return;
    }

    syncAvatars();
    placeViewmodel();

    // The terminal's texture is drawn BEFORE the scene, so what the scene
    // samples is this frame's UI rather than last frame's.
    updateWorldMatrices(scene);
    drawTerminal();

    // The world. The scene canvas is stacked underneath this one, so this is
    // the whole of the 3D draw — nothing is blitted into the 2D context.
    renderer.render(scene, camera);

    if (phase !== "match") {
      drawLobby();
      return;
    }

    // And the HUD, ordinary screen-space UI on the transparent 2D canvas.
    if (damageFlash > 0) {
      Draw.rect(0, 0, view.w, view.h, `rgba(190,30,40,${(damageFlash * 0.32).toFixed(3)})`);
    }
    drawNameplates();
    if (!paused && deployed && respawnIn === 0) {
      drawCrosshair();
      drawCaptureHint();
    }
    drawHud();
    if (showingBoard()) drawScoreboard();
    if (paused) drawPauseMenu();
    // Last, so the sticks sit above the HUD they overlap — and skipped while
    // paused, where the menu owns the pointer.
    if (!paused) OnscreenInput.drawControls(pad);
  },
});

/** Push this step's position and aim into the shared state. One place, called
 *  at the end of every step including a paused one — a player who opens the
 *  menu should keep existing on everyone else's screen. */
function publish(): void {
  me.x = player.x;
  me.y = player.y;
  me.z = player.z;
  me.vx = velocity.x;
  me.vz = velocity.z;
  me.yaw = camera.yaw;
  me.pitch = camera.pitch;
  me.live = deployed && respawnIn === 0 ? 1 : 0;
  me.name = playerName;
}

const showingBoard = (): boolean => Keys.down("Tab") || boardPin;

/** The camera stores a VERTICAL fov; players think in horizontal. The
 *  conversion needs the aspect ratio, which is why the menu keeps the
 *  horizontal number and derives this every frame rather than the reverse. */
function verticalFov(fovXDegrees: number): number {
  const aspect = view.w / Math.max(1, view.h);
  return 2 * Math.atan(Math.tan((fovXDegrees * Math.PI) / 360) / aspect);
}

// ---- look and move ---------------------------------------------------------

function lookStep(dt: number): void {
  // Invert is applied to the DELTA rather than passed to `look`: it is a
  // player preference, not a property of the camera, and the engine has no
  // business having an opinion about it.
  if (locked) {
    look(camera, lockDx, settings.invertY ? -lockDy : lockDy, LOOK_BASE * settings.sensitivity);
  }
  lockDx = 0;
  lockDy = 0;
  // Arrow keys look too, always. Pointer lock is refused inside a cross-origin
  // iframe and on some embedded browsers, and a first-person sample that simply
  // cannot be turned in those is no sample at all. The right stick looks on the
  // same terms; its units are −1..1 per STEP, so both are scaled to the pixel
  // deltas `look` takes, and `turn` is what a held arrow key is worth over one
  // step — which makes stick and keyboard turn at one rate.
  const turn = 900 * dt;
  const invert = settings.invertY ? -1 : 1;
  if (pad.axis(2) !== 0 || pad.axis(3) !== 0) {
    look(camera, pad.axis(2) * turn, pad.axis(3) * turn * invert, LOOK_BASE * settings.sensitivity);
  }
  look(
    camera,
    ((Keys.down("ArrowRight") ? 1 : 0) - (Keys.down("ArrowLeft") ? 1 : 0)) * turn,
    ((Keys.down("ArrowDown") ? 1 : 0) - (Keys.down("ArrowUp") ? 1 : 0)) * turn * invert,
    LOOK_BASE * settings.sensitivity,
  );
}

function moveStep(dt: number): void {
  // Movement in the camera's own frame, normalized so diagonals are not
  // faster — the oldest bug in first-person movement.
  cameraForward(camera, forward);
  const flying = !deployed || respawnIn > 0;
  // A spectator flies: forward means where you are LOOKING, including up. A
  // deployed player walks, so the same vector is flattened.
  if (!flying) forward.y = 0;
  Vec3.normalize(forward);
  cameraRight(camera, right);

  // Keys and the pad's left stick sum, then clamp: a player using both at once
  // should not go twice as fast.
  const ahead = clamp1((Keys.down("KeyW") ? 1 : 0) - (Keys.down("KeyS") ? 1 : 0) - pad.axis(1));
  const side = clamp1((Keys.down("KeyD") ? 1 : 0) - (Keys.down("KeyA") ? 1 : 0) + pad.axis(0));
  const lift = flying ? (Keys.down("KeyE") ? 1 : 0) - (Keys.down("KeyQ") ? 1 : 0) : 0;
  const fast = Keys.down("ShiftLeft") || pad.down(Buttons.X);
  const speed = flying ? (fast ? 22 : 11) : fast ? 9 : 5.5;
  Vec3.set(
    wish,
    forward.x * ahead + right.x * side,
    forward.y * ahead + lift,
    forward.z * ahead + right.z * side,
  );
  if (wish.x !== 0 || wish.y !== 0 || wish.z !== 0) Vec3.normalize(wish);

  // `1 - e^(-k·dt)` is the frame-rate-independent form of exponential
  // smoothing; the naive `v += (want - v) * k` changes feel with the step.
  const accel = 1 - Math.exp(-(flying ? 10 : 18) * dt);
  velocity.x += (wish.x * speed - velocity.x) * accel;
  velocity.z += (wish.z * speed - velocity.z) * accel;
  velocity.y += ((flying ? wish.y * speed : 0) - velocity.y) * accel;
  player.x += velocity.x * dt;
  player.z += velocity.z * dt;

  if (flying) {
    // No collision while spectating: flying through the walls to look at the
    // arena from outside is the point of a free camera.
    player.y = Math.max(0.4, Math.min(24, player.y + velocity.y * dt));
  } else {
    resolve(player, PLAYER_RADIUS);
    player.y = EYE_HEIGHT;
    velocity.y = 0;
    // Footfalls are spaced by DISTANCE, not by time, so a sprint and a walk
    // have the same stride and the cadence follows the speed for free — which
    // is also why a player pushing into a wall goes quiet: `resolve` has
    // already cancelled the movement, so nothing accumulates.
    stepDistance += Math.hypot(velocity.x, velocity.z) * dt;
    if (stepDistance >= 1.9) {
      stepDistance = 0;
      sfx.step.play({ pitch: [0.85, 1.15] });
    }
  }
  placeEye(camera, player);
}

/** The lobby's own camera: a slow high orbit of the arena, so the browser has
 *  something behind it that is the actual level rather than a colour. */
function lobbyStep(dt: number): void {
  lobbyOrbit += dt * 0.08;
  const r = 20;
  player.x = Math.sin(lobbyOrbit) * r;
  player.z = Math.cos(lobbyOrbit) * r;
  player.y = 11;
  // Look back at the middle. `cameraForward` is
  // `(-sin yaw · cos pitch, -sin pitch, -cos yaw · cos pitch)`, so aiming at the
  // origin from `(sin o · r, ·, cos o · r)` needs yaw = o — NOT o + π, which
  // points at the sky outside the arena — and looking DOWN needs a POSITIVE
  // pitch, because that y term is negated.
  camera.yaw = lobbyOrbit;
  camera.pitch = 0.42;
  placeEye(camera, player);
  scene.lights[1].intensity = 0.5;
  scene.ambient = [0.22, 0.24, 0.32];
}

// ---- avatars ---------------------------------------------------------------

/** Hand the avatar pool out to whoever is present, and park the rest. Runs in
 *  DRAW rather than update, because what it positions is the interpolated
 *  state — which is a function of the wall clock, not of the fixed step. */
function syncAvatars(): void {
  const others = phase === "match" && match ? match.others : [];
  let i = 0;
  for (const other of others) {
    if (i >= avatars.length) break;
    // A spectator has no body, so there is nothing to draw and nothing to shoot.
    if (other.live !== 1) continue;
    const avatar = avatars[i++];
    const pivot = scene.nodes[avatar.pivot];
    pivot.hidden = false;
    pivot.position.x = other.x;
    // The shared `y` is the EYE height; the pivot sits at the chest.
    pivot.position.y = other.y - 0.55;
    pivot.position.z = other.z;
    Quat.fromAxisAngle(pivot.rotation, 0, 1, 0, other.yaw);
    if (avatar.seat !== other.index) {
      avatar.seat = other.index;
      const colour = seatRgb(other.index);
      scene.nodes[avatar.head].material = { color: colour, shininess: 60, specular: 0.4 };
    }
    // Fade toward the floor as they die — cheap, and it reads at any range.
    const hurt = Math.max(0, Math.min(1, other.hp / MAX_HEALTH));
    Vec3.set(pivot.scale, 1, 0.6 + hurt * 0.4, 1);
  }
  for (; i < avatars.length; i++) scene.nodes[avatars[i].pivot].hidden = true;
}

/** A name and a health number over each visible player.
 *
 *  `UI.worldLabel` is the 2D engine's version of this and takes a 2D camera, so
 *  it is the wrong tool here; `worldToScreen` is the 3D one, and it returns
 *  null behind the eye — which is the cull that stops a player standing behind
 *  you having their name mirrored onto the far side of the screen. */
function drawNameplates(): void {
  if (!match) return;
  const head: Vec3 = { x: 0, y: 0, z: 0 };
  for (const other of match.others) {
    if (other.live !== 1) continue;
    Vec3.set(head, other.x, other.y + 0.55, other.z);
    const at = worldToScreen(camera, head, view.w, view.h);
    if (!at || at.depth > 34) continue;
    // Fade with distance so a crowded arena does not become a wall of text.
    const alpha = Math.max(0.25, Math.min(1, 1.4 - at.depth / 34));
    UI.text(`${other.name || `P${other.index + 1}`}  ${Math.max(0, Math.round(other.hp))}`, {
      x: at.x - 100,
      y: at.y - 8,
      w: 200,
      align: "center",
      size: 11,
      bold: true,
      color: seatCss(other.index, alpha),
    });
  }
}

// ---- the terminal's UI -----------------------------------------------------

function drawTerminal(): void {
  const world = match?.world;
  terminal.draw(
    {
      model: scene.nodes[terminalNode].world!,
      camera,
      // A locked pointer has no position, so the CROSSHAIR is the pointer —
      // the centre of the screen. That substitution is the whole trick that
      // makes a world-space panel usable in a first-person game. Unlocked, the
      // real cursor is a position again and is used as one.
      // Frozen while a menu is up: the pointer belongs to the menu, and a
      // crosshair that is not being aimed should not be hovering a wall panel.
      pointer:
        !terminalNear || paused || showingBoard()
          ? null
          : locked
            ? { x: view.w / 2, y: view.h / 2, viewW: view.w, viewH: view.h }
            : { x: Pointer.x, y: Pointer.y, viewW: view.w, viewH: view.h },
    },
    () =>
      UI.idScope("terminal", () => {
        UI.text("ARENA CONTROL", { x: 14, y: 12, size: 14, bold: true, color: "accent" });
        UI.text(
          !match
            ? "offline"
            : match.net.hosting
              ? "you own this panel"
              : `owned by the host · ${match.net.count} in room`,
          { x: 14, y: 32, size: 10, color: "dim" },
        );
        UI.text(terminalNear ? "aim and click to operate" : "step closer", {
          x: 14,
          y: 48,
          size: 11,
          color: "dim",
        });
        // `tabIndex: -1` on every control: a diegetic panel is operated by
        // pointing at it, and a widget that accepts keyboard FOCUS also
        // swallows the keys the game is using — Space and Enter activate the
        // focused widget, the arrows traverse between them. Without this,
        // walking up to the terminal once quietly disables looking around.
        //
        // These are not local booleans. A click sends a REQUEST to the host,
        // which owns the record and broadcasts it back; the toggle shows what
        // the room agreed on, not what this client wishes. On a lossy link that
        // means a switch can visibly lag its own press, and that is honest.
        UI.col({ x: 14, y: 74, w: 232, gap: 8 }, () => {
          if (
            UI.toggle({ label: "Ambient light", on: world?.ambient ?? true, tabIndex: -1 }) !==
            (world?.ambient ?? true)
          ) {
            match?.toggle("ambient");
            sfx.click.play();
          }
          if (
            UI.toggle({ label: "Fill light", on: world?.fill ?? true, tabIndex: -1 }) !==
            (world?.fill ?? true)
          ) {
            match?.toggle("fill");
            sfx.click.play();
          }
          if (UI.button({ label: "Reset targets", w: 232, tabIndex: -1 })) {
            match?.resetTargets();
            sfx.click.play();
          }
        });
      }),
  );
}

// ---- the lobby screen ------------------------------------------------------

function drawLobby(): void {
  Draw.rect(0, 0, view.w, view.h, "rgba(6,8,14,0.62)");

  UI.panel({ anchor: "center", w: 560, title: "ARENA · LOBBY", pad: 18 }, () => {
    UI.col({ gap: 12 }, () => {
      UI.text(
        phase === "connecting"
          ? "finding the relay…"
          : phase === "joining"
            ? "joining…"
            : lobby?.online
              ? `connected · ${lobby.here} here`
              : "no relay answered — you can still host and play solo",
        { size: 11, color: lobby?.online === false ? "#ffb347" : "dim" },
      );
      if (joinError) UI.text(joinError, { size: 11, color: "#f0603a", wrap: true });

      UI.row({ gap: 10, fitCross: true, alignCross: "center" }, () => {
        UI.text("NAME", { size: 11, bold: true, color: "dim", w: 52 });
        playerName = UI.textInput({
          id: "name",
          value: playerName,
          w: 180,
          // Long enough for the longest pair the generator can roll
          // ("Restless Wolfhound-2"), and no longer — a nameplate has to stay
          // readable across the arena.
          maxLength: 22,
          placeholder: "your callsign",
        }).value;
        if (UI.button({ id: "reroll", label: "⟳", w: 36, tooltip: "roll a new callsign" })) {
          playerName = randomName();
          sfx.click.play();
        }
        if (
          UI.button({
            id: "host",
            label: "Host a match",
            w: 196,
            variant: "primary",
            disabled: phase !== "lobby",
          })
        ) {
          void enterMatch(newCode(), true);
        }
      });

      UI.row({ gap: 10, fitCross: true, alignCross: "center" }, () => {
        UI.text("CODE", { size: 11, bold: true, color: "dim", w: 52 });
        const field = UI.textInput({
          id: "code",
          value: codeField,
          w: 200,
          maxLength: 6,
          placeholder: "e.g. K3QP",
        });
        codeField = field.value.toUpperCase();
        const go = codeField.trim().length > 0 && phase === "lobby";
        if (
          UI.button({ id: "connect", label: "Connect", w: 200, disabled: !go }) ||
          (field.submitted && go)
        ) {
          void enterMatch(codeField.trim(), false);
        }
      });

      UI.text("OPEN MATCHES", { size: 11, bold: true, color: "dim" });
      drawMatchList();

      UI.text(
        "A match is just a room. Hosting advertises its code in this lobby; joining by code needs no lobby at all — which is why it still works with nothing listening.",
        { size: 10, color: "dim", wrap: true, w: 524 },
      );
    });
  });
}

let listOffset = 0;
const ROW_H = 40;
const ROW_GAP = 3;

function drawMatchList(): void {
  const matches: MatchAd[] = lobby?.matches ?? [];
  if (matches.length === 0) {
    UI.text(
      phase === "connecting" ? "…" : "nothing advertised yet — host one, or open this page twice",
      { size: 11, color: "dim" },
    );
    return;
  }
  // The list is placed by the FLOW, not by `w`/`h`: with `x`/`y` omitted it
  // auto-flows and fills its container, and `w`/`h` are ignored. That is the
  // right behaviour and the wrong shape for a panel that hugs its content —
  // "fill" inside an auto-height column has nothing to fill, so the list grows
  // to thousands of pixels and drags the panel off the screen with it. Bounding
  // the fill with one fixed-height column is the fix; the cap keeps a busy
  // lobby scrolling instead of growing.
  const rows = Math.min(4, matches.length);
  UI.col({ w: 524, h: rows * ROW_H + (rows - 1) * ROW_GAP }, () => {
    listOffset = UI.list(
      { rowH: ROW_H, gap: ROW_GAP, count: matches.length, offset: listOffset, id: "matches" },
      drawMatchRow,
    );
  });

  function drawMatchRow(i: number, r: { x: number; y: number; w: number; h: number }): void {
    const ad = matches[i];
    if (UI.listItem({ ...r, id: `match-${i}` }) && phase === "lobby") {
      void enterMatch(ad.code, false);
    }
    UI.row(
      { x: r.x + 10, y: r.y + 6, w: r.w - 20, gap: 10, fitCross: true, alignCross: "center" },
      () => {
        UI.text(ad.code, { size: 14, bold: true, color: "accent", w: 60 });
        UI.text(ad.title, { size: 12, w: 300 });
        UI.text(`${ad.players}/${ad.max}`, { size: 11, color: "dim" });
      },
    );
  }
}

// ---- HUD -------------------------------------------------------------------

function drawCrosshair(): void {
  const cx = view.w / 2;
  const cy = view.h / 2;
  // The gap grows with recoil — the cheapest possible way to make firing feel
  // like it did something.
  const gap = 5 + recoil * 9;
  const len = 7;
  const color = hitMarker > 0 ? "#ff5b5b" : "rgba(235,240,255,0.85)";
  Draw.rect(cx - gap - len, cy - 1, len, 2, color);
  Draw.rect(cx + gap, cy - 1, len, 2, color);
  Draw.rect(cx - 1, cy - gap - len, 2, len, color);
  Draw.rect(cx - 1, cy + gap, 2, len, color);
  Draw.rect(cx - 1, cy - 1, 2, 2, color);

  if (hitMarker > 0) {
    const r = 10 + (1 - hitMarker) * 10;
    Draw.rectStroke(cx - r, cy - r, r * 2, r * 2, `rgba(255,91,91,${hitMarker.toFixed(3)})`, 2);
  }
  // No screen-space flash: it is a child of the barrel now, so it is drawn
  // with the world and lands on the muzzle by construction.
}

/** Playing, but the mouse is free — after Esc, after a tab switch, or before
 *  the first click. Only a real click can take the pointer back, so say so
 *  rather than leaving the player waggling a mouse that does nothing. */
function drawCaptureHint(): void {
  if (locked || lockRefused || OnscreenInput.visible(pad)) return;
  const text = "Click to capture the mouse";
  const y = view.h / 2 + 52;
  UI.text(text, { x: view.w / 2, y, align: "center", size: 13, color: "rgba(235,240,255,0.8)" });
}

function drawHud(): void {
  const inset = 24;
  // The sticks own the bottom corners when touch is live, so the bottom HUD
  // lifts above them. `visible` is the same signal the controls fade on, so
  // the two move together instead of the HUD guessing at the device.
  const lift = OnscreenInput.visible(pad) ? 170 : 0;
  const net = match?.net;

  // Score and connection, top left.
  UI.col({ x: inset, y: inset, w: 420, gap: 2 }, () => {
    UI.text(`SCORE ${score}`, { size: 20, bold: true });
    UI.text(
      `${me.kills}K / ${me.deaths}D · ${hits}/${shots} hits · ${shots ? Math.round((hits / shots) * 100) : 0}%`,
      { size: 11, color: "dim" },
    );
    UI.text(
      net
        ? `${match!.code} · ${net.count} player${net.count === 1 ? "" : "s"} · ` +
            (net.online
              ? net.hosting
                ? "host"
                : `${Math.round(net.rttMs)} ms`
              : "solo — no relay answered") +
            ` · ${renderer?.backend ?? "…"}`
        : (renderer?.backend ?? "starting…"),
      { size: 11, color: net?.online === false ? "#ffb347" : "dim" },
    );
    if (settings.showStats && renderer) {
      const st = renderer.stats;
      UI.text(
        `${st.drawCalls} draws · ${st.triangles.toLocaleString()} tris · ${st.culled} culled · ${Loop.timings.drawMs.toFixed(1)} ms · ${Math.round(settings.renderScale * 100)}% scale`,
        { size: 11, color: "dim" },
      );
    }
    if (settings.showNet && net) {
      // The meter accumulates; `sample` is what turns it into rates, and it
      // wants calling once a frame — which this is.
      const s = net.meter.sample(performance.now());
      UI.text(
        `${settings.interpDelayMs} ms render delay · ${match!.others.length} remote · ` +
          `${(s.downBps / 1024).toFixed(1)}↓ ${(s.upBps / 1024).toFixed(1)}↑ KiB/s · ` +
          `${Math.round(s.downMsgs)}↓ ${Math.round(s.upMsgs)}↑ msg/s`,
        { size: 11, color: "#8be0d0" },
      );
    }
  });

  // Health, bottom left.
  UI.col({ x: inset, y: view.h - 78 - lift, w: 240, gap: 6 }, () => {
    UI.text(deployed && respawnIn === 0 ? "HEALTH" : "SPECTATING", {
      size: 11,
      color: "dim",
      bold: true,
    });
    UI.bar({
      value: deployed && respawnIn === 0 ? me.hp / MAX_HEALTH : 0,
      w: 240,
      h: 14,
      fill: me.hp > 34 ? "#4ade80" : "#f0603a",
    });
  });

  // Ammo, bottom right — hand-drawn, because a magazine reads as a row of
  // rounds rather than as a number.
  if (deployed && respawnIn === 0) {
    const rowW = MAG * 17 - 6;
    const ammoX = view.w - inset - rowW;
    UI.text(reloading > 0 ? "RELOADING" : "AMMO", {
      x: ammoX,
      y: view.h - 78 - lift,
      w: rowW,
      align: "right",
      size: 11,
      bold: true,
      color: reloading > 0 ? "#ffb347" : "dim",
    });
    const rowY = view.h - 56 - lift;
    if (reloading > 0) {
      Draw.rect(ammoX, rowY, rowW, 22, "rgba(255,255,255,0.08)");
      Draw.rect(ammoX, rowY, rowW * (1 - reloading / RELOAD_TIME), 22, "#ffb347");
    } else {
      for (let i = 0; i < MAG; i++) {
        Draw.rect(ammoX + i * 17, rowY, 11, 22, i < ammo ? "#e8ecf6" : "rgba(232,236,246,0.14)");
      }
    }
  }

  // A fading centre message.
  if (message && messageAge < 2) {
    const alpha = Math.min(1, (2 - messageAge) * 1.5);
    UI.text(message, {
      x: 0,
      y: view.h * 0.34,
      w: view.w,
      align: "center",
      size: 16,
      bold: true,
      color: `rgba(120,230,180,${alpha.toFixed(3)})`,
    });
  }

  if (!deployed || respawnIn > 0) {
    drawSpectatePrompt();
  } else if (terminalNear) {
    UI.text("aim at the terminal and click to operate it", {
      x: 0,
      y: view.h - 140,
      w: view.w,
      align: "center",
      size: 12,
      color: "dim",
    });
  }

  if (!locked && !OnscreenInput.visible(pad) && !paused) {
    UI.text("click the view to lock the mouse · arrows look · F fires · Tab scores", {
      x: 0,
      y: view.h - 108,
      w: view.w,
      align: "center",
      size: 11,
      color: "dim",
    });
  }
}

/** The spectate overlay — the "press to join" the player is waiting behind, and
 *  the respawn countdown, which is the same screen with the prompt disabled. */
function drawSpectatePrompt(): void {
  const touch = OnscreenInput.visible(pad);
  const dead = respawnIn > 0;
  UI.panel({ anchor: "center", w: 440, title: dead ? "DOWN" : "SPECTATING", pad: 16 }, () => {
    UI.col({ gap: 8 }, () => {
      if (dead) {
        UI.text(`${killedBy} got you.`, { size: 13 });
        UI.text(`back in ${respawnIn.toFixed(1)}s`, { size: 20, bold: true, color: "accent" });
      } else {
        UI.text("Free camera. Fly the arena, then drop in when you're ready.", {
          size: 12,
          wrap: true,
          w: 404,
        });
        UI.text(
          touch
            ? "Left stick flies · right stick looks"
            : "WASD flies · Q/E down and up · Shift boosts",
          { size: 11, color: "dim" },
        );
        // Pointer lock is a mouse concern; on touch the sticks already are
        // the answer and the warning would be noise.
        if (!touch) {
          UI.text(
            lockRefused
              ? "This browser refused the pointer lock — arrows look, F fires."
              : "No mouse? Arrows look and F fires, locked or not.",
            { size: 11, color: lockRefused ? "#ffb347" : "dim" },
          );
        }
        if (
          UI.button({
            label: touch ? "TAP TO DEPLOY" : "DEPLOY  (Enter)",
            w: 404,
            variant: "primary",
          })
        ) {
          deploy();
        }
      }
      UI.text("Tab shows the scoreboard · Esc for settings and leaving", {
        size: 10,
        color: "dim",
      });
    });
  });
}

// ---- the scoreboard --------------------------------------------------------

function drawScoreboard(): void {
  if (!match) return;
  Draw.rect(0, 0, view.w, view.h, "rgba(6,8,14,0.5)");
  const roster = match.roster;
  UI.panel({ anchor: "center", w: 520, title: `SCOREBOARD · ${match.code}`, pad: 16 }, () => {
    UI.col({ gap: 4 }, () => {
      row("", "PLAYER", "K", "D", "PING", true);
      for (const p of roster) row(...line(p));
    });
  });

  function line(p: RemotePlayer): [string, string, string, string, string, boolean] {
    const mine = p.id === me_id();
    return [
      `${p.index + 1}`,
      `${p.name || `P${p.index + 1}`}${mine ? " · you" : ""}${p.id === match!.net.room.hostId ? " · host" : ""}`,
      `${p.kills}`,
      `${p.deaths}`,
      // Only our own round trip is measured — a peer's ping to a third peer is
      // not ours to report, and inventing one would be worse than a dash.
      mine ? `${Math.round(match!.net.rttMs)}` : "–",
      mine,
    ];
  }

  function row(
    seat: string,
    name: string,
    kills: string,
    deaths: string,
    ping: string,
    strong: boolean,
  ): void {
    UI.row({ gap: 10, fitCross: true, alignCross: "center" }, () => {
      UI.text(seat, { size: 12, w: 24, color: "dim" });
      UI.text(name, { size: 13, w: 280, bold: strong, color: strong ? "accent" : undefined });
      UI.text(kills, { size: 13, w: 44, align: "right", bold: strong });
      UI.text(deaths, { size: 13, w: 44, align: "right", color: "dim" });
      UI.text(ping, { size: 12, w: 56, align: "right", color: "dim" });
    });
  }
}

// ---- the pause menu --------------------------------------------------------
// An ordinary `UI.panel`. It draws on the SAME transparent canvas as the HUD,
// above the scene layer, so the frozen world shows through behind it — no
// render target, no blur pass, no second camera.

function drawPauseMenu(): void {
  // Dim the world so the menu reads as modal. On the 2D canvas, so it costs
  // one filled rect and touches nothing about the scene.
  Draw.rect(0, 0, view.w, view.h, "rgba(6,8,14,0.55)");

  UI.panel({ anchor: "center", w: 440, title: "PAUSED", pad: 18 }, (flow: Flow) => {
    // The panel's inner width, after its padding — the sliders and the button
    // pairs are sized from it rather than from a copy of `440 − 2 × 18` that
    // would go stale the moment either number moved.
    const w = flow.crossSize ?? 384;
    UI.col({ w, gap: 10 }, () => {
      settings.fovX = UI.slider({
        label: "FOV",
        value: settings.fovX,
        min: 60,
        max: 120,
        step: 1,
        w,
        format: (v) => `${v | 0}° wide`,
      });
      settings.sensitivity = UI.slider({
        label: "Sensitivity",
        value: settings.sensitivity,
        min: 0.25,
        max: 3,
        step: 0.05,
        w,
        format: (v) => `${v.toFixed(2)}×`,
      });
      settings.renderScale = UI.slider({
        label: "Render scale",
        value: settings.renderScale,
        min: 0.4,
        max: 1,
        step: 0.05,
        w,
        format: (v) => `${Math.round(v * 100)}% (HUD stays sharp)`,
      });
      settings.interpDelayMs = UI.slider({
        label: "Interp delay",
        value: settings.interpDelayMs,
        min: 0,
        max: 250,
        step: 10,
        w,
        // The caveat is its own line rather than part of the value: a long
        // format string squeezes the slider's own track to a stub.
        format: (v) => `${v} ms`,
      });
      // The buffer is built when the match is joined, so moving the slider now
      // arms the NEXT one. Saying so beats a control that appears to do nothing.
      UI.text("Render delay for other players · applies on the next match", {
        size: 10,
        color: "dim",
      });

      settings.volume = UI.slider({
        label: "Volume",
        value: settings.volume,
        min: 0,
        max: 1,
        step: 0.05,
        w,
        format: (v) => (v === 0 ? "muted" : `${Math.round(v * 100)}%`),
      });

      UI.row({ gap: 16, fitCross: true, alignCross: "center" }, () => {
        settings.invertY = UI.toggle("Invert Y", settings.invertY);
        settings.showStats = UI.toggle("GPU stats", settings.showStats);
        settings.showNet = UI.toggle("Net stats", settings.showNet);
      });

      UI.row({ gap: 8, fitCross: true, alignCross: "center" }, () => {
        UI.text("BACKEND", { size: 11, bold: true, color: "dim" });
        for (const backend of ["webgl2", "webgpu"] as const) {
          const on = renderer?.backend === backend;
          if (
            UI.button({
              label: backend,
              w: 90,
              disabled: switching || (backend === "webgpu" && !webgpuOk),
              tooltip: backend === "webgpu" && !webgpuOk ? "no WebGPU in this browser" : undefined,
              bg: on ? "#2c3550" : undefined,
              color: on ? "#8be0d0" : undefined,
            })
          ) {
            void useBackend(backend);
          }
        }
      });
      if (rendererError) UI.text(rendererError, { size: 11, color: "#f0603a" });

      UI.row({ gap: 8 }, () => {
        if (UI.button({ label: "Resume", w: (w - 8) / 2, variant: "primary" })) {
          resume();
          // A click is still within its activation window here, so unlike Esc
          // this one is allowed to take the mouse back.
          grabPointer();
        }
        if (UI.button({ label: "Reset run", w: (w - 8) / 2 })) {
          match?.resetTargets();
          score = 0;
          shots = 0;
          hits = 0;
          ammo = MAG;
          reloading = 0;
          say("RUN RESET");
        }
      });
      UI.row({ gap: 8 }, () => {
        if (UI.button({ label: "Back to spectate", w: (w - 8) / 2, disabled: !deployed })) {
          deployed = false;
          respawnIn = 0;
          me.live = 0;
          paused = false;
        }
        // Leaving is the room being CLOSED, not a screen change: the share
        // stops, the peers see us time out, and the lobby room is re-opened.
        if (UI.button({ label: "Disconnect", w: (w - 8) / 2 })) leaveMatch();
      });
      UI.text("Esc closes · click the view to re-lock the mouse", { size: 10, color: "dim" });
    });
  });
}

/** Close the menu and hand the game back.
 *
 *  It does not itself re-take the mouse, because whether it CAN depends on how
 *  it was called. `requestPointerLock` needs transient activation, which a real
 *  click grants for a few seconds — so the Resume BUTTON can re-lock, and does,
 *  by calling `grabPointer` next to this. Escape cannot: it is one of the keys
 *  specifically excluded from granting activation, so a request made off it is
 *  refused, always. The version before this one asked sixty times a second for
 *  two seconds after Esc and was refused all 120 times; the mouse never came
 *  back, and the player pressing Esc again to find out why simply reopened the
 *  menu. That is the "Esc resume is buggy, the menu reappears" report.
 *
 *  So Esc resumes unlocked and `drawCaptureHint` asks for the one click that is
 *  allowed to work. The game stays playable meanwhile — arrows look, F fires,
 *  locked or not. */
function resume(): void {
  paused = false;
}

/** Clamp to the −1..1 an axis promises, after summing two input sources. */
function clamp1(v: number): number {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

// Exposed so the end-to-end tests can assert on real session state rather than
// pixels — a sample is also a testbed.
Object.defineProperty(window, "fps", {
  value: {
    get phase() {
      return phase;
    },
    get deployed() {
      return deployed;
    },
    get paused() {
      return paused;
    },
    get code() {
      return match?.code ?? null;
    },
    get count() {
      return match?.net.count ?? 0;
    },
    get online() {
      return match?.net.online ?? false;
    },
    get hosting() {
      return match?.net.hosting ?? false;
    },
    get world() {
      return match ? { ...match.world } : null;
    },
    /** Everyone else as DRAWN — the interpolated read, not the newest packet.
     *  A test that asserts on this is asserting on what a player sees. */
    get remotes() {
      return (match?.others ?? []).map((o) => ({
        id: o.id,
        x: +o.x.toFixed(2),
        y: +o.y.toFixed(2),
        z: +o.z.toFixed(2),
        yaw: +o.yaw.toFixed(3),
        hp: o.hp,
        live: o.live,
      }));
    },
    get roster() {
      return (match?.roster ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        kills: p.kills,
        deaths: p.deaths,
      }));
    },
    get lobby() {
      return { online: lobby?.online ?? false, matches: lobby?.matches ?? [] };
    },
    get me() {
      return { x: player.x, y: player.y, z: player.z, hp: me.hp, live: me.live };
    },
    get score() {
      return score;
    },
    get shots() {
      return shots;
    },
    rollName: () => randomName(),
    get reload() {
      return { active: reloading > 0, stage: reloadStage, ammo };
    },
    get terminal() {
      return { near: terminalNear, aiming: aimingAtTerminal };
    },
    // The three things a headless client genuinely cannot do for itself: aiming
    // needs a locked pointer, firing needs a mouse button, and operating the
    // terminal needs a ray cast from a body standing in front of it.
    aim: (yaw: number, pitch = 0) => {
      camera.yaw = yaw;
      camera.pitch = pitch;
      placeEye(camera, player);
      publish();
    },
    fire: () => fire(),
    toggle: (key: "ambient" | "fill") => match?.toggle(key),
    host: () => enterMatch(newCode(), true),
    join: (code: string) => enterMatch(code, false),
    deploy: () => deploy(),
    leave: () => leaveMatch(),
    pause: (on: boolean) => (paused = on),
    board: (on: boolean) => (boardPin = on),
    backend: (b: Backend3D) => useBackend(b),
    layoutCapture: (on: boolean) => UI.layoutCapture(on),
    layoutTree: () => UI.layoutTree(),
    layoutIssues: () => UI.layoutIssues(),
  },
});
