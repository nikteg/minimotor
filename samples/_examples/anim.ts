import { Stage, Loop, Keys, Anim, Assets, Draw } from "minimotor";

Stage.init("game", { background: "#12141c" });

// One image PER state (idle.png, run.png, …) — the multi-image companion to
// Anim.sheet. `art.idle` etc. are typed from the manifest keys.
const art = await Assets.load({ idle: "hero-idle.png", run: "hero-run.png" });
const hero = Anim.states({
  idle: { image: art.idle, frames: 4, fps: 6 },
  run: { image: art.run, frames: 6, fps: 12 },
});
const anim = hero.play("idle");
const player = { x: 140, y: 110, w: 32, h: 48, vx: 0 };

Loop.run({
  update() {
    player.vx = (Keys.down("ArrowRight") ? 2 : 0) - (Keys.down("ArrowLeft") ? 2 : 0);
    player.x += player.vx;
    anim.set(player.vx !== 0 ? "run" : "idle"); // key is typed to the state names
  },
  draw() {
    // The cursor's `.sheet.image` switches with the state; flip to face travel.
    Draw.sprite(anim, player, { flipX: player.vx < 0 });
  },
});
