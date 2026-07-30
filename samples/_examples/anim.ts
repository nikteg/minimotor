import { createAnimation } from "minimotor/animation";
import { createAssets } from "minimotor/assets";
import { createApp } from "minimotor";

const app = createApp("game", { background: "#12141c" });
const Anim = createAnimation(app);
const { Loop, Keys, Draw } = app;
const Assets = createAssets(app);

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
    anim.set(player.vx !== 0 ? "run" : "idle");
  },
  draw() {
    Draw.sprite(anim, player, { flipX: player.vx < 0 });
  },
});
