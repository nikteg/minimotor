import { Stage, Loop, Keys, Camera, ECS, Draw } from "minimotor";

Stage.init("game", { background: "#12141c" });

// A world bigger than the screen, dotted with drifting agents held in an ECS.
const WORLD = { x: 0, y: 0, w: 1280, h: 720 };
const ecs = ECS.create();
const Body = ECS.component<{ x: number; y: number; vx: number; vy: number }>("body");
for (let i = 0; i < 80; i++) {
  const a = i * 2.4;
  ecs.spawn(
    Body.with({ x: (i * 97) % WORLD.w, y: (i * 53) % WORLD.h, vx: Math.cos(a), vy: Math.sin(a) }),
  );
}

const hero = { x: 640, y: 360, w: 24, h: 24 };
Camera.follow(hero, { world: WORLD, damping: 0.1 }); // deadzone-free smooth follow

Loop.run({
  update() {
    hero.x += (Keys.down("ArrowRight") ? 3 : 0) - (Keys.down("ArrowLeft") ? 3 : 0);
    hero.y += (Keys.down("ArrowDown") ? 3 : 0) - (Keys.down("ArrowUp") ? 3 : 0);
    for (const b of ecs.dense(Body)) {
      b.x = (b.x + b.vx + WORLD.w) % WORLD.w;
      b.y = (b.y + b.vy + WORLD.h) % WORLD.h;
    }
  },
  draw() {
    Camera.render(() => {
      // Data never draws itself — walk the packed store and blit each row.
      for (const b of ecs.dense(Body)) Draw.rect(b.x, b.y, 6, 6, "#3a3f4a");
      Draw.rect(hero, "#4ecdc4");
    });
  },
});
