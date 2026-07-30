import { createApp, Tiles, Collision } from "minimotor";

const app = createApp("game", { background: "#12141c" });
const { Loop, Keys, Draw } = app;

const level = Tiles.grid(
  `
  .........
  ...#.....
  ......#..
  #########
  `,
  { size: 24, legend: { "#": { solid: true } } },
);
const skin = { "#": "#3a3f4a" } satisfies Tiles.Skin<typeof level>;

const player = { x: 48, y: 0, w: 20, h: 20, vel: { x: 0, y: 0 }, grounded: false };

Loop.run({
  update() {
    player.vel.x = (Keys.down("ArrowRight") ? 2 : 0) - (Keys.down("ArrowLeft") ? 2 : 0);
    if (player.grounded && Keys.pressed("Space")) player.vel.y = -8;
    player.vel.y += 0.5;
    Collision.moveAndSlide(player, level);
  },
  draw() {
    Draw.tiles(level, skin);
    Draw.rect(player, "#4ecdc4");
  },
});
