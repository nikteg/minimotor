import { App, Tiles, Collision } from "minimotor";

const game = App.create("game", { background: "#12141c" });
const { Loop, Keys, Draw } = game;

// The level IS the data: an ASCII grid + a semantics-only legend.
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
    if (player.grounded && Keys.pressed("Space")) player.vel.y = -8; // jump
    player.vel.y += 0.5; // gravity (px/step²)
    // Swept move-and-slide vs the tiles; sets `player.grounded` on landing.
    Collision.moveAndSlide(player, level);
  },
  draw() {
    Draw.tiles(level, skin);
    Draw.rect(player, "#4ecdc4");
  },
});
