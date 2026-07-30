import { App } from "minimotor";
import { createPhysics2D } from "minimotor/physics2d";

const game = App.create("game", { background: "#161922" });
const { Draw, Loop, viewport: view } = game;
const Physics2D = createPhysics2D(game);
const world = Physics2D.world();
world.walls(0, 0, view.w, view.h);
const ball = world.circle(view.w / 2, 40, 20, {
  density: 1,
  restitution: 0.7,
});

Loop.run({
  update() {},
  draw() {
    Draw.circle(ball.x, ball.y, 20, "#4ecdc4");
  },
});
