import { createAnimation } from "minimotor/animation";
import { createPerformanceMonitoring } from "minimotor/performance";
// Sprite-sheet animation on the ECS.
// Demonstrates: Sprites.atlas (procedural sprite-sheet baking), Anim.sheet
// (frame slicing + clock-derived playback), the ECS Sprite source-rect
// (sx/sy/sw/sh), Draw.sprites(ecs.dense(Sprites.Sprite)), and Goodies.wrap. The sheet is generated
// procedurally so the sample needs no asset files — an 8-frame
// pulsing/rotating star.
import { createUI } from "minimotor/ui";
import { ECS, Goodies, Mathf, Sprites, App } from "minimotor";

const ecs = ECS.create();

const game = App.create("game", { background: "#12141c" });
const Anim = createAnimation(game);
createPerformanceMonitoring(game, { world: ecs });
const view = game.viewport;
const { Draw, Loop, Pointer } = game;
const UI = createUI(game);

const FRAMES = 8;
const CELL = 64;

// ---- Bake a sprite sheet (1 row × 8 cells) once ----
// Sprites.atlas sizes the canvas; origin: "center" puts (0,0) at each cell's
// centre, so the per-frame callback just spins the star about the origin.
const sheetCanvas = Sprites.atlas(
  CELL,
  CELL,
  FRAMES,
  (c, i) => {
    const t = i / FRAMES;
    c.rotate(t * Math.PI * 2); // spin
    const r = 14 + Mathf.pulse(t * Math.PI * 2) * 12; // pulse the size
    c.fillStyle = `hsl(${Math.round(t * 360)}, 80%, 60%)`;
    c.beginPath();
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2;
      const rad = p % 2 === 0 ? r : r * 0.45;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
  },
  { origin: "center" },
);

// One clock-derived playback cursor drives every star; per-entity frame
// offsets desync the timelines.
const starSheet = Anim.sheet(sheetCanvas, {
  frame: { w: CELL, h: CELL },
  states: { spin: { row: 0, frames: FRAMES, fps: 12 } },
});
const spin = starSheet.play("spin");

const Vel = ECS.component<{ x: number; y: number }>("Vel");
const Animated = ECS.component<{ offset: number }>("Animated"); // holds the per-entity frame offset

function spawnStar(x: number, y: number) {
  const offset = Mathf.randInt(0, FRAMES - 1); // desync the timelines
  const r = starSheet.rect("spin", offset);
  const a = Math.random() * Math.PI * 2;
  const speed = 1 + Math.random() * 2;
  ecs.spawn(
    Sprites.Sprite.with({
      x,
      y,
      img: sheetCanvas,
      sx: r.sx,
      sy: r.sy,
      sw: r.sw,
      sh: r.sh,
      scale: 0.8,
    }),
    Vel.with({ x: Math.cos(a) * speed, y: Math.sin(a) * speed }),
    Animated.with({ offset }),
  );
}

for (let i = 0; i < 12; i++) spawnStar(Math.random() * view.w, Math.random() * view.h);

// Write each entity's current frame into the Sprite's source rect — so the
// built-in renderer shows the right cell. Also drift + wrap.
ecs.system("animate", (w) => {
  for (const [, s, v, an] of w.query(Sprites.Sprite, Vel, Animated)) {
    const r = starSheet.rect("spin", (spin.frame + an.offset) % FRAMES);
    s.sx = r.sx;
    s.sy = r.sy;
    s.sw = r.sw;
    s.sh = r.sh;
    s.x = Goodies.wrap(s.x + v.x, view.w);
    s.y = Goodies.wrap(s.y + v.y, view.h);
  }
});

Loop.run({
  update() {
    if (Pointer.pressed) spawnStar(Pointer.x, Pointer.y);
    ecs.update();
  },
  draw() {
    Draw.sprites(ecs.dense(Sprites.Sprite)); // blits each Sprite's current source rect
    UI.text(`${ecs.count(Sprites.Sprite)} animated sprites · click to add`, {
      x: 10,
      y: 8,
      size: 14,
    });
  },
});
