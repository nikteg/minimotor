import { createPerformanceMonitoring } from "minimotor/performance";
// Particle system demo: firework sparks on the ECS with the standard Sprite
// component + renderer.
// Demonstrates: Sprites.Sprite (position + texture + alpha), Draw.sprites(ecs.dense(Sprite)) —
// no hand-written blit loop — plus an update system that fades sprites out.
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import * as Sprites from "minimotor/sprites";
import { component, createEcs } from "minimotor/ecs";

const ecs = createEcs();

// The perf HUD shows this world's live entity count (`ents`).
// The viewport is LIVE (mutated on resize); the engine owns clearing.
const game = createApp("game", { background: "#000" });
createPerformanceMonitoring(game, { world: ecs });
const view = game.viewport;
const { Draw, Loop, Pointer } = game;
const UI = createUI(game);

const NUM = 200;
const SIZE = 8;

// The standard Sprite component carries x/y/img/alpha; Vel is our own. Sprite
// lives in the Sprites namespace, not the ECS — the ECS stays sprite-agnostic.
// The spark's alpha doubles as its remaining life, so no separate Life component.
const { Sprite } = Sprites;
const Vel = component<{ x: number; y: number }>("Vel");

// Pre-render the spark texture once.
const sparkCanvas = Sprites.getSprite("spark", SIZE * 3, view.dpr, (ctx) => {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, SIZE);
  g.addColorStop(0, "rgba(255,255,200,1)");
  g.addColorStop(0.3, "rgba(255,150,50,0.8)");
  g.addColorStop(1, "rgba(255,50,20,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, SIZE, 0, Math.PI * 2);
  ctx.fill();
});

function spawnBurst(x: number, y: number) {
  for (let i = 0; i < NUM; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 5;
    ecs.spawn(
      Sprite.with({ x, y, img: sparkCanvas, alpha: 1 }),
      Vel.with({ x: Math.cos(a) * speed, y: Math.sin(a) * speed }),
    );
  }
}

spawnBurst(view.w / 2, view.h / 2);

// Simulation system: move, gravity, fade the sprite's alpha (= life), despawn at
// zero. Despawning mid-query is safe — the world buffers it until iteration ends.
ecs.system("integrate", (w) => {
  const G = 0.21; // px/step² — a soft firework gravity
  for (const [e, s, v] of w.query(Sprite, Vel)) {
    s.x += v.x;
    s.y += v.y;
    v.y += G;
    s.alpha = (s.alpha ?? 0) - 0.008;
    if (s.alpha <= 0) w.despawn(e);
  }
});

Loop.run({
  update() {
    // Click/tap anywhere to spawn sparks (pointer is polled, no listeners).
    if (Pointer.pressed) spawnBurst(Pointer.x, Pointer.y);
    ecs.update(); // runs update systems in order, then flushes despawns
  },
  draw() {
    Draw.sprites(ecs.dense(Sprite)); // renderer: centers + blits every Sprite by z
    UI.panel({ x: 10, y: 10, w: 230, h: 58, title: "PARTICLES" }, (body) =>
      UI.text(`Sparks ${ecs.count(Sprite)}  ·  click to spawn`, { h: body.remaining, size: 13 }),
    );
  },
});
