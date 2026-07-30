import { App } from "minimotor";
import { createInput } from "minimotor/input";
import { createNet } from "minimotor/net";

const game = App.create("game", {
  background: "#10141c",
  resolution: { w: 800, h: 450 },
});
const { Draw, Loop, viewport: view } = game;
const Input = createInput(game);
const Net = createNet(game);
const net = await Net.game({ room: "{{name}}" });
const me = {
  x: 80 + net.index * 40,
  y: 225,
  vel: { x: 0, y: 0 },
  color: Net.playerColor(net.index),
};
const players = net.share(me);
const input = Input.map({
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
});

Loop.run({
  update() {
    me.vel.x = input.axis("left", "right") * 3;
    me.vel.y = input.axis("up", "down") * 3;
    me.x = Math.max(12, Math.min(view.w - 12, me.x + me.vel.x));
    me.y = Math.max(12, Math.min(view.h - 12, me.y + me.vel.y));
  },
  draw() {
    for (const player of players) Draw.circle(player.x, player.y, 12, player.color);
    Draw.circle(me.x, me.y, 12, me.color);
  },
});
