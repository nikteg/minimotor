import { App, Mathf } from "minimotor";

const game = App.create("game", { background: "#20242c" });
const { Draw, Keys, Loop, viewport: view } = game;
const player = { x: 40, y: 40, w: 32, h: 32 };

Loop.run({
  update() {
    const x = Number(Keys.down("ArrowRight")) - Number(Keys.down("ArrowLeft"));
    const y = Number(Keys.down("ArrowDown")) - Number(Keys.down("ArrowUp"));
    player.x = Mathf.clamp(player.x + x * 3, 0, view.w - player.w);
    player.y = Mathf.clamp(player.y + y * 3, 0, view.h - player.h);
  },
  draw() {
    Draw.rect(player.x, player.y, player.w, player.h, "#4ecdc4");
  },
});
