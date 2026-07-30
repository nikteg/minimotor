import { App, Collision, Tiles } from "minimotor";
import { createInput } from "minimotor/input";

const game = App.create("game", {
  background: "#8bd3dd",
  resolution: { w: 480, h: 270 },
});
const { Draw, Loop } = game;
const Input = createInput(game);
const level = Tiles.grid(
  `..............................
..............................
...........####...............
P.....###...........####......
##############################`,
  {
    size: 16,
    legend: { "#": { solid: true } },
  },
);
const input = Input.map({
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  jump: ["Space"],
});
const start = level.spawnOne("P");
const player = {
  x: start.x - 6,
  y: start.y - 12,
  w: 12,
  h: 24,
  vel: { x: 0, y: 0 },
  grounded: false,
};

Loop.run({
  update() {
    player.vel.x = input.axis("left", "right") * 2;
    player.vel.y += 0.25;
    if (input.jump.pressed && player.grounded) player.vel.y = -5;
    Collision.moveAndSlide(player, level);
  },
  draw() {
    Draw.tiles(level, { "#": "#41644a" });
    Draw.rect(player.x, player.y, player.w, player.h, "#ff6b6b");
  },
});
