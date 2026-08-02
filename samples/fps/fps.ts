// A small first-person shooter: WASD + mouse look, hitscan fire, and a HUD
// drawn entirely with the ordinary minimotor UI.
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
//                  press is not a HUD.
//
// The third, `UI.viewport3d`, is absent because nothing here is a 3D view
// inside a panel. `samples/render3d` is the one that shows that.
//
// Everything else is ordinary engine work: the level is boxes, collision
// pushes a circle out of them, and firing is a ray/AABB test. It is a sample,
// not a shooter — there is no gravity beyond a floor clamp and no enemy AI
// beyond bobbing in place.
import { createUI } from "minimotor/ui";
import { Vec3, createApp } from "minimotor";
import {
  addNode,
  attachSceneLayer,
  box,
  cameraForward,
  cameraRight,
  createCamera,
  createRenderer3D,
  createScene,
  createUiSurface,
  look,
  node,
  placeEye,
  plane,
  sphere,
  updateWorldMatrices,
  type Renderer3D,
} from "minimotor/3d";

// No `background`: the engine then leaves the play area unpainted, so the 2D
// canvas stays transparent and the scene layer shows through it. Passing one
// here would hide the entire 3D world behind an opaque fill — the first thing
// to check if a scene layer renders black.
const game = createApp("game");
const view = game.viewport;
const { Draw, Keys, Loop, Pointer } = game;
const UI = createUI(game);

// ---- the level -------------------------------------------------------------

const EYE_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.35;

interface Box {
  /** Centre. */
  x: number;
  y: number;
  z: number;
  /** Half-extents. */
  hx: number;
  hy: number;
  hz: number;
}

const walls: Box[] = [];

const scene = createScene({
  ambient: [0.22, 0.24, 0.32],
  lights: [
    { direction: { x: -0.4, y: -1, z: -0.35 }, color: [1, 0.95, 0.85], intensity: 0.95 },
    { direction: { x: 0.7, y: -0.25, z: 0.6 }, color: [0.35, 0.5, 0.95], intensity: 0.5 },
  ],
  background: [0.05, 0.06, 0.09, 1],
});

/** Add a solid box to both the scene and the collision list. */
function solid(b: Box, color: readonly [number, number, number, number]): void {
  addNode(
    scene,
    node({
      mesh: box(b.hx * 2, b.hy * 2, b.hz * 2),
      position: { x: b.x, y: b.y, z: b.z },
      material: { color, shininess: 20, specular: 0.1 },
    }),
  );
  walls.push(b);
}

// The floor is a plane rather than a box, so the player never stands inside a
// collider.
addNode(
  scene,
  node({
    mesh: plane(40, 40, 1),
    material: { color: [0.13, 0.14, 0.19, 1] },
  }),
);

const WALL: readonly [number, number, number, number] = [0.2, 0.22, 0.3, 1];
const CRATE: readonly [number, number, number, number] = [0.45, 0.34, 0.2, 1];

// An arena, walled on four sides.
for (const [x, z, hx, hz] of [
  [0, -14, 14, 0.5],
  [0, 14, 14, 0.5],
  [-14, 0, 0.5, 14],
  [14, 0, 0.5, 14],
] as const) {
  solid({ x, y: 1.6, z, hx, hy: 1.6, hz }, WALL);
}
// Cover to hide behind and shoot around. Nothing sits on x ≈ 0: the player
// spawns at (0, 8) facing the terminal at (0, −13.4), and a crate in that lane
// means the sample opens with you jammed against a box.
for (const [x, z, s] of [
  [-5, -6, 1.1],
  [4, -8, 0.9],
  [7, 3, 1.3],
  [-6, 6, 1],
  [3.2, 1, 0.7],
  [-9, -1, 0.8],
] as const) {
  solid({ x, y: s, z, hx: s, hy: s, hz: s }, CRATE);
}

// ---- targets ---------------------------------------------------------------

interface Target {
  node: number;
  box: Box;
  alive: boolean;
  /** Seconds since it was hit; 0 while alive. Drives the sink-and-respawn. */
  dying: number;
  bob: number;
}

/** Height every target floats at. Close to the 1.7 eye height on purpose: the
 *  camera starts level, and a target centred much lower is missed by a
 *  horizontal shot at the top of its bob. */
const BASE_Y = 1.5;

const targets: Target[] = [];
for (const [x, z, phase] of [
  [-8, -9, 0],
  [6, -11, 0.9],
  [10, 6, 1.8],
  [-10, 8, 2.7],
  [2, 9, 3.6],
  [-2, -4, 4.5],
  [9, -3, 5.4],
] as const) {
  targets.push({
    node: addNode(
      scene,
      node({
        mesh: sphere(0.55, 20, 14),
        position: { x, y: BASE_Y, z },
        material: { color: [0.92, 0.3, 0.34, 1], shininess: 60, specular: 0.4 },
      }),
    ),
    box: { x, y: BASE_Y, z, hx: 0.55, hy: 0.55, hz: 0.55 },
    alive: true,
    dying: 0,
    bob: phase,
  });
}

// ---- the in-world terminal -------------------------------------------------
// A real minimotor UI on a quad, standing in the level. Walk up to it and
// click: the buttons hover and press exactly as they do on the HUD, because
// they ARE the same widgets. Only the pointer's POSITION is re-derived, by
// casting its ray at the quad; the press and release edges are the real
// device's.

const TERMINAL_POS = { x: 0, y: 1.9, z: -13.4 };
const terminal = createUiSurface({
  // Required here and not in `samples/render3d`: that one draws its surface
  // from inside a `UI.viewport3d` callback, which has already selected the app.
  // This one draws straight from `Loop.draw`, so the surface has to be told.
  app: game,
  width: 260,
  height: 190,
  worldWidth: 2.2,
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
    mesh: box(2.5, 1.85, 0.12),
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

let brightAmbient = true;
let fillLight = true;

// ---- player ----------------------------------------------------------------

// `fov` is VERTICAL, and on a 16:9 screen 60° vertical is about 91° across —
// the usual shooter figure. Quoting the horizontal number instead is where the
// fish-eye comes from: 75° vertical is 110° horizontal, and a sphere near the
// edge of that stretches into an egg.
const camera = createCamera({ fov: Math.PI / 3, near: 0.08, far: 80, yaw: 0, pitch: 0 });
const player: Vec3 = { x: 0, y: EYE_HEIGHT, z: 8 };
const velocity: Vec3 = { x: 0, y: 0, z: 0 };

const MAG = 12;
const RELOAD_TIME = 1.1;
let ammo = MAG;
let reloading = 0;
let score = 0;
let shots = 0;
let hits = 0;
let recoil = 0;
let hitMarker = 0;
let muzzle = 0;
let message = "";
let messageAge = 99;
/** Set once the player moves, looks or fires — dismisses the instructions. */
let playing = false;

// ---- mouse look ------------------------------------------------------------
// Pointer lock gives movementX/Y DELTAS, which the engine's polled `Pointer`
// deliberately does not model — it reports a position, and a locked pointer has
// none. So this sample owns the listener. If a second game ever needs it, this
// is the shape that would move into `src/input`.

let lockDx = 0;
let lockDy = 0;
let locked = false;

game.canvas.addEventListener("click", () => {
  if (locked) return;
  // Chrome returns a promise that REJECTS when the lock is refused — inside a
  // cross-origin iframe, or in headless. Unhandled, that is a console error on
  // every click; Safari returns undefined, hence the guard.
  const p: unknown = game.canvas.requestPointerLock();
  if (p instanceof Promise) p.catch(() => (lockRefused = true));
});
let lockRefused = false;
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === game.canvas;
});
document.addEventListener("mousemove", (e) => {
  if (!locked) return;
  // Accumulated, not assigned: several mousemove events can arrive between two
  // fixed steps, and keeping only the last one loses most of a fast flick.
  lockDx += e.movementX;
  lockDy += e.movementY;
});

// ---- collision -------------------------------------------------------------

/** Push the player (a circle, seen from above) out of every wall it overlaps.
 *  Resolving on the axis of LEAST penetration is what makes sliding along a
 *  wall feel right instead of sticking to it. */
function resolve(p: Vec3, radius: number): void {
  for (const w of walls) {
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    const ox = w.hx + radius - Math.abs(dx);
    const oz = w.hz + radius - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) p.x += Math.sign(dx || 1) * ox;
    else p.z += Math.sign(dz || 1) * oz;
  }
}

/** Distance along a ray to an AABB, or Infinity for a miss. The slab method:
 *  clip the ray against each axis's pair of planes and see whether an interval
 *  survives. */
function rayBox(origin: Vec3, dir: Vec3, b: Box): number {
  let near = 0;
  let far = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  const c = [b.x, b.y, b.z];
  const h = [b.hx, b.hy, b.hz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      // Parallel to this slab: a miss unless the origin is already between its
      // planes.
      if (Math.abs(o[i] - c[i]) > h[i]) return Infinity;
      continue;
    }
    const inv = 1 / d[i];
    let t0 = (c[i] - h[i] - o[i]) * inv;
    let t1 = (c[i] + h[i] - o[i]) * inv;
    if (t0 > t1) [t0, t1] = [t1, t0];
    near = Math.max(near, t0);
    far = Math.min(far, t1);
    if (near > far) return Infinity;
  }
  return near;
}

const forward: Vec3 = { x: 0, y: 0, z: 0 };
const right: Vec3 = { x: 0, y: 0, z: 0 };
const wish: Vec3 = { x: 0, y: 0, z: 0 };

function say(text: string): void {
  message = text;
  messageAge = 0;
}

function reload(): void {
  if (reloading > 0 || ammo === MAG) return;
  reloading = RELOAD_TIME;
}

function fire(): void {
  if (reloading > 0 || ammo <= 0) return;
  ammo--;
  shots++;
  recoil = 1;
  muzzle = 1;
  playing = true;
  cameraForward(camera, forward);

  // Nearest target, but only if no wall is nearer — otherwise you shoot through
  // cover, which is the bug every first hitscan has.
  let bestT = Infinity;
  let bestTarget: Target | null = null;
  for (const t of targets) {
    if (!t.alive) continue;
    const d = rayBox(player, forward, t.box);
    if (d < bestT) {
      bestT = d;
      bestTarget = t;
    }
  }
  let wallT = Infinity;
  for (const w of walls) wallT = Math.min(wallT, rayBox(player, forward, w));

  if (bestTarget && bestT < wallT) {
    bestTarget.alive = false;
    bestTarget.dying = 1e-6;
    hits++;
    score += 100;
    hitMarker = 1;
    say("TARGET DOWN  +100");
  }
}

function revive(t: Target): void {
  const n = scene.nodes[t.node];
  t.alive = true;
  t.dying = 0;
  Vec3.set(n.scale, 1, 1, 1);
  n.hidden = false;
}

// ---- renderer --------------------------------------------------------------

let renderer: Renderer3D | null = null;
let backendName = "starting…";

void createRenderer3D({ antialias: true }).then((r) => {
  renderer = r;
  backendName = r.backend;
  attachSceneLayer(game, r);
});

// ---- frame -----------------------------------------------------------------

/** In reach of the terminal — recomputed each step, read by both the draw and
 *  the fire gate. */
let terminalNear = false;

Loop.run({
  update() {
    const dt = Loop.step / 1000;

    if (locked) look(camera, lockDx, lockDy);
    lockDx = 0;
    lockDy = 0;
    // Arrow keys look too, always. Pointer lock is refused inside a
    // cross-origin iframe and on some embedded browsers, and a first-person
    // sample that simply cannot be turned in those is no sample at all. The
    // rate is in the same pixel units `look` takes, scaled by the step.
    const turn = 900 * dt;
    look(
      camera,
      ((Keys.down("ArrowRight") ? 1 : 0) - (Keys.down("ArrowLeft") ? 1 : 0)) * turn,
      ((Keys.down("ArrowDown") ? 1 : 0) - (Keys.down("ArrowUp") ? 1 : 0)) * turn,
    );

    // Movement in the camera's own frame, normalized so diagonals are not
    // faster — the oldest bug in first-person movement.
    cameraForward(camera, forward);
    forward.y = 0;
    Vec3.normalize(forward);
    cameraRight(camera, right);

    const ahead = (Keys.down("KeyW") ? 1 : 0) - (Keys.down("KeyS") ? 1 : 0);
    const side = (Keys.down("KeyD") ? 1 : 0) - (Keys.down("KeyA") ? 1 : 0);
    const speed = Keys.down("ShiftLeft") ? 9 : 5.5;
    Vec3.set(wish, forward.x * ahead + right.x * side, 0, forward.z * ahead + right.z * side);
    if (wish.x !== 0 || wish.z !== 0) {
      Vec3.normalize(wish);
      playing = true;
    }

    // `1 - e^(-k·dt)` is the frame-rate-independent form of exponential
    // smoothing; the naive `v += (want - v) * k` changes feel with the step.
    const accel = 1 - Math.exp(-18 * dt);
    velocity.x += (wish.x * speed - velocity.x) * accel;
    velocity.z += (wish.z * speed - velocity.z) * accel;
    player.x += velocity.x * dt;
    player.z += velocity.z * dt;
    resolve(player, PLAYER_RADIUS);
    player.y = EYE_HEIGHT;
    placeEye(camera, player);

    if (Keys.pressed("KeyR")) reload();
    if (reloading > 0) {
      reloading -= dt;
      if (reloading <= 0) {
        reloading = 0;
        ammo = MAG;
        say("RELOADED");
      }
    }

    terminalNear = Math.hypot(player.x - TERMINAL_POS.x, player.z - TERMINAL_POS.z) < 4.5;

    // Fire on press. When the terminal is in reach the click belongs to IT
    // instead — a wall panel you accidentally shoot at while trying to press is
    // worse than one you cannot shoot at all.
    // F, not Space: clicking the terminal gives one of its widgets keyboard
    // focus, and Space/Enter is how the UI activates a focused widget. Bind
    // fire to Space and every shot also presses whatever button the player
    // last touched — which here silently reset the score.
    if ((Pointer.framePressed && locked && !terminalNear) || Keys.pressed("KeyF")) fire();
    if (ammo === 0 && reloading === 0) reload();

    recoil = Math.max(0, recoil - dt * 5);
    muzzle = Math.max(0, muzzle - dt * 12);
    hitMarker = Math.max(0, hitMarker - dt * 2.5);
    messageAge += dt;

    for (const t of targets) {
      const n = scene.nodes[t.node];
      t.bob += dt * 1.6;
      if (t.alive) {
        // The hit box bobs WITH the art. Leaving it at the base height is the
        // classic "I shot it and nothing happened" — invisible, and only at the
        // extremes of the animation.
        n.position.y = BASE_Y + Math.sin(t.bob) * 0.16;
        t.box.y = n.position.y;
        continue;
      }
      t.dying += dt;
      // Sink and shrink, then come back — a sample wants targets that respawn.
      const k = Math.min(1, t.dying / 0.5);
      n.position.y = BASE_Y - k * 1.4;
      Vec3.set(n.scale, 1 - k, 1 - k, 1 - k);
      n.hidden = k >= 1;
      if (t.dying > 3) revive(t);
    }

    scene.lights[1].intensity = fillLight ? 0.5 : 0;
    scene.ambient = brightAmbient ? [0.22, 0.24, 0.32] : [0.08, 0.09, 0.13];
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

    // The terminal's texture is drawn BEFORE the scene, so what the scene
    // samples is this frame's UI rather than last frame's.
    updateWorldMatrices(scene);
    drawTerminal();

    // The world. The scene canvas is stacked underneath this one, so this is
    // the whole of the 3D draw — nothing is blitted into the 2D context.
    renderer.render(scene, camera);

    // And the HUD, ordinary screen-space UI on the transparent 2D canvas.
    drawCrosshair();
    drawHud();
  },
});

// ---- the terminal's UI -----------------------------------------------------

function drawTerminal(): void {
  terminal.draw(
    {
      model: scene.nodes[terminalNode].world!,
      camera,
      // A locked pointer has no position, so the CROSSHAIR is the pointer —
      // the centre of the screen. That substitution is the whole trick that
      // makes a world-space panel usable in a first-person game. Unlocked, the
      // real cursor is a position again and is used as one.
      pointer: !terminalNear
        ? null
        : locked
          ? { x: view.w / 2, y: view.h / 2, viewW: view.w, viewH: view.h }
          : { x: Pointer.x, y: Pointer.y, viewW: view.w, viewH: view.h },
    },
    () =>
      UI.idScope("terminal", () => {
        UI.text("ARENA CONTROL", { x: 14, y: 12, size: 14, bold: true, color: "accent" });
        UI.text(terminalNear ? "aim and click to operate" : "step closer", {
          x: 14,
          y: 34,
          size: 11,
          color: "dim",
        });
        // `tabIndex: -1` on every control: a diegetic panel is operated by
        // pointing at it, and a widget that accepts keyboard FOCUS also
        // swallows the keys the game is using — Space and Enter activate the
        // focused widget, the arrows traverse between them. Without this,
        // walking up to the terminal once quietly disables looking around.
        UI.col({ x: 14, y: 58, w: 232, gap: 8 }, () => {
          brightAmbient = UI.toggle({ label: "Ambient light", on: brightAmbient, tabIndex: -1 });
          fillLight = UI.toggle({ label: "Fill light", on: fillLight, tabIndex: -1 });
          if (UI.button({ label: "Reset targets", w: 232, tabIndex: -1 })) {
            for (const t of targets) revive(t);
            score = 0;
            shots = 0;
            hits = 0;
            say("TARGETS RESET");
          }
        });
      }),
  );
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
  if (muzzle > 0) {
    // A flash low and right, where a weapon would be.
    Draw.rect(
      view.w * 0.66,
      view.h - 34 - muzzle * 8,
      44 * muzzle,
      12 * muzzle,
      `rgba(255,214,138,${(muzzle * 0.8).toFixed(3)})`,
    );
  }
}

function drawHud(): void {
  const pad = 24;

  // Score, top left.
  UI.col({ x: pad, y: pad, w: 340, gap: 2 }, () => {
    UI.text(`SCORE ${score}`, { size: 20, bold: true });
    UI.text(
      `${hits}/${shots} hits · ${shots ? Math.round((hits / shots) * 100) : 0}% · ${backendName}`,
      { size: 11, color: "dim" },
    );
  });

  // Health, bottom left. Nothing shoots back in a range, so this is here to
  // show the widget rather than to threaten anyone.
  UI.col({ x: pad, y: view.h - 78, w: 240, gap: 6 }, () => {
    UI.text("HEALTH", { size: 11, color: "dim", bold: true });
    UI.bar({ value: 1, w: 240, h: 14, fill: "#4ade80" });
  });

  // Ammo, bottom right — hand-drawn, because a magazine reads as a row of
  // rounds rather than as a number.
  const rowW = MAG * 17 - 6;
  const ammoX = view.w - pad - rowW;
  UI.text(reloading > 0 ? "RELOADING" : "AMMO", {
    x: ammoX,
    y: view.h - 78,
    w: rowW,
    align: "right",
    size: 11,
    bold: true,
    color: reloading > 0 ? "#ffb347" : "dim",
  });
  const rowY = view.h - 56;
  if (reloading > 0) {
    Draw.rect(ammoX, rowY, rowW, 22, "rgba(255,255,255,0.08)");
    Draw.rect(ammoX, rowY, rowW * (1 - reloading / RELOAD_TIME), 22, "#ffb347");
  } else {
    for (let i = 0; i < MAG; i++) {
      Draw.rect(ammoX + i * 17, rowY, 11, 22, i < ammo ? "#e8ecf6" : "rgba(232,236,246,0.14)");
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

  // The instructions cover the middle of the screen, so they go away the moment
  // the player does anything — including on a browser that refused the lock,
  // where waiting for `locked` would leave them up forever.
  if (!locked && !playing) {
    UI.panel({ anchor: "center", w: 420, title: "CLICK TO PLAY" }, () => {
      UI.text("WASD move · Shift sprint · mouse look", { size: 12 });
      UI.text("Click fire · R reload · Esc release the pointer", { size: 12 });
      UI.text(
        lockRefused
          ? "This browser refused the pointer lock — arrows look, F fires."
          : "No mouse? Arrows look and F fires, locked or not.",
        { size: 11, color: lockRefused ? "#ffb347" : "dim" },
      );
      UI.text("Walk to the wall terminal and click: that panel is a real", {
        size: 11,
        color: "dim",
      });
      UI.text("minimotor UI living on a quad inside the level.", { size: 11, color: "dim" });
    });
  } else if (!locked) {
    UI.text("click the view to lock the mouse · arrows look · F fires", {
      x: 0,
      y: view.h - 108,
      w: view.w,
      align: "center",
      size: 11,
      color: "dim",
    });
  }
  if (terminalNear) {
    UI.text("aim at the terminal and click to operate it", {
      x: 0,
      y: view.h - 140,
      w: view.w,
      align: "center",
      size: 12,
      color: "dim",
    });
  }
}
