// Deterministic 8×8 checker, drawn at 4× — a pixel-diff harness for the
// Canvas2D vs WebGL2 sprite paths. `?renderer=webgl` selects the batcher.
import { createApp } from "minimotor";
import * as Sprites from "minimotor/sprites";

const wantGl = new URLSearchParams(location.search).get("renderer") === "webgl";
const game = createApp("game", {
  background: "#102030",
  renderer: wantGl ? "webgl" : "canvas",
  resolution: { w: 64, h: 64 },
});
const { Draw, Loop } = game;

const cell = Sprites.atlas(8, 8, 1, (g) => {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#e22" : "#fff";
      g.fillRect(x, y, 1, 1);
    }
  }
});

Loop.run({
  update() {},
  draw() {
    Draw.sprites([
      { x: 16, y: 16, img: cell, w: 32, h: 32, ax: 0, ay: 0 },
      { x: 48, y: 48, img: cell, w: 16, h: 16, ax: 0, ay: 0 },
    ]);
    window.__gpuBlit = { renderer: game.renderer, ready: true };
  },
});

declare global {
  interface Window {
    __gpuBlit?: { renderer: "canvas" | "webgl"; ready: boolean };
  }
}
