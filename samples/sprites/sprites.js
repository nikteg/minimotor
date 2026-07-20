// Sprite-sheet animation on the ECS.
// Demonstrates: Anim.sheet (frame slicing + timing), the ECS Sprite source-rect
// (sx/sy/sw/sh), and world.drawSprites(). The sheet is generated procedurally
// so the sample needs no asset files — an 8-frame pulsing/rotating star.
import { Minimotor } from "minimotor";

const { ECS, Anim, Draw, Loop, Pointer, Mathf } = Minimotor;
const world = ECS.world();

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin({ world })] });
Minimotor.Stage.onResize((next) => (vp = next)); // wrap bounds read vp live

const FRAMES = 8;
const CELL = 64;

// ---- Build a sprite sheet (1 row × 8 cells) on an offscreen canvas ----
const sheetCanvas = document.createElement("canvas");
sheetCanvas.width = CELL * FRAMES;
sheetCanvas.height = CELL;
{
  const c = sheetCanvas.getContext("2d");
  for (let i = 0; i < FRAMES; i++) {
    const t = i / FRAMES;
    const cx = i * CELL + CELL / 2;
    const cy = CELL / 2;
    const spin = t * Math.PI * 2;
    const r = 14 + Mathf.pulse(t * Math.PI * 2) * 12; // pulse the size
    const hue = Math.round(t * 360);
    c.save();
    c.translate(cx, cy);
    c.rotate(spin);
    c.fillStyle = `hsl(${hue}, 80%, 60%)`;
    c.beginPath();
    for (let p = 0; p < 10; p++) {
      const a = (p / 10) * Math.PI * 2;
      const rad = p % 2 === 0 ? r : r * 0.45;
      c.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    c.closePath();
    c.fill();
    c.restore();
  }
}

const Vel = ECS.component("Vel");
const Animated = ECS.component("Anim"); // holds the per-entity Animation

function spawnStar(x, y) {
  const anim = Anim.sheet(sheetCanvas, { fw: CELL, fh: CELL, fps: 12 });
  anim.update(Mathf.randRange(0, (FRAMES / 12) * 1000)); // desync the timelines
  const a = Math.random() * Math.PI * 2;
  const speed = 1 + Math.random() * 2;
  world.spawn(
    ECS.Sprite.with({ x, y, img: sheetCanvas, ...anim.rect, scale: 0.8 }),
    Vel.with({ x: Math.cos(a) * speed, y: Math.sin(a) * speed }),
    Animated.with({ anim }),
  );
}

for (let i = 0; i < 12; i++) spawnStar(Math.random() * vp.w, Math.random() * vp.h);

// Advance each animation and write its current frame into the Sprite's source
// rect — so the built-in renderer shows the right cell. Also drift + wrap.
world.system("animate", (w) => {
  for (const [, s, v, an] of w.query(ECS.Sprite, Vel, Animated)) {
    an.anim.update(Loop.step);
    const r = an.anim.rect;
    s.sx = r.sx;
    s.sy = r.sy;
    s.sw = r.sw;
    s.sh = r.sh;
    s.x = (s.x + v.x + vp.w) % vp.w;
    s.y = (s.y + v.y + vp.h) % vp.h;
  }
});

Loop.run({
  update() {
    if (Pointer.pressed) spawnStar(Pointer.x, Pointer.y);
    world.update();
  },
  draw() {
    const { ctx } = Draw;
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, vp.w, vp.h);
    world.drawSprites(ctx); // blits each Sprite's current source rect
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`${world.count(ECS.Sprite)} animated sprites · click to add`, 10, 22);
  },
});
