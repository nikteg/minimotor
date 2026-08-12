import { createDebug } from "minimotor/debug";
import { createInput } from "minimotor/input";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createUI } from "minimotor/ui";
import { createApp, Goodies, Gizmos } from "minimotor";

const game = createApp("game", { background: "#0f141a" });
createDebug(game, { initial: "performance" });
const view = game.viewport;
const { Loop, Draw, Pointer } = game;
const Input = createInput(game);
const UI = createUI(game, Input);
const OnscreenInput = createOnscreenInput(game, Input, UI);

// An on-screen gamepad: a left analog stick + two face buttons. `autohide:false`
// keeps it on screen on desktop too — a mouse drives it while it's visible, and
// touch always does. On a phone it's the whole controller.
const pad = OnscreenInput.gamepad({
  autohide: false,
  opacity: 0.6,
  haptics: true,
  stick: { anchor: { side: "left", x: 92, y: 92 }, radius: 62 },
  buttons: [
    { anchor: { side: "right", x: 138, y: 78 }, r: 36, button: "a", label: "GO" },
    { anchor: { side: "right", x: 74, y: 146 }, r: 30, button: "b", label: "◼" },
  ],
});

// The pad feeds the SAME action map as the keyboard — one code path.
const input = Input.map(
  {
    up: ["KeyW", "ArrowUp", "pad:lstick-up"],
    down: ["KeyS", "ArrowDown", "pad:lstick-down"],
    left: ["KeyA", "ArrowLeft", "pad:lstick-left"],
    right: ["KeyD", "ArrowRight", "pad:lstick-right"],
    boost: ["Space", "pad:a"],
    brake: ["ShiftLeft", "pad:b"],
  },
  { pad },
);

const rover = { x: view.w / 2, y: view.h / 2, scale: 1 };
const trail = Gizmos.trail(42);
let pinchStart = 0;
let scaleStart = 1;
let rawTouches = false;

Loop.run({
  update() {
    if (rawTouches) {
      const touches = Pointer.touches;
      if (touches.length === 1) {
        rover.x = Goodies.wrap(touches[0].x, view.w);
        rover.y = Goodies.wrap(touches[0].y, view.h);
        pinchStart = 0;
      } else if (touches.length >= 2) {
        const dx = touches[1].x - touches[0].x;
        const dy = touches[1].y - touches[0].y;
        const dist = Math.hypot(dx, dy);
        if (pinchStart === 0) {
          pinchStart = dist;
          scaleStart = rover.scale;
        } else if (pinchStart > 0) {
          rover.scale = Math.max(0.4, Math.min(4, scaleStart * (dist / pinchStart)));
        }
        rover.x = Goodies.wrap((touches[0].x + touches[1].x) / 2, view.w);
        rover.y = Goodies.wrap((touches[0].y + touches[1].y) / 2, view.h);
      } else {
        pinchStart = 0;
      }
    } else {
      const move = input.vector("left", "right", "up", "down"); // analog, no diagonal boost
      const speed = (input.brake.down ? 0.5 : 1) * (input.boost.down ? 6 : 3.4);
      rover.x = Goodies.wrap(rover.x + move.x * speed, view.w);
      rover.y = Goodies.wrap(rover.y + move.y * speed, view.h);
    }
    trail.push(rover.x, rover.y);
  },
  draw() {
    // points are newest-first; fade toward the oldest tail end.
    const pts = trail.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      Draw.opacity(((pts.length - 1 - i) / pts.length) * 0.5, () =>
        Draw.circle(p.x, p.y, 4 * rover.scale, "#2a6f78"),
      );
    }
    Draw.circle(
      rover.x,
      rover.y,
      12 * rover.scale,
      !rawTouches && input.boost.down ? "#ffd166" : "#4ecdc4",
    );
    if (rawTouches) {
      for (const t of Pointer.touches) {
        Draw.circleStroke(t.x, t.y, 28, "#ffd166", 2);
        Draw.circle(t.x, t.y, 6, "#ffd166");
      }
    }
    UI.row({ x: 12, y: 8, gap: 10, alignCross: "center" }, () => {
      UI.text(
        rawTouches ? "One finger drives · two fingers pinch" : "Stick + GO — or WASD / Space",
        {
          size: 13,
          color: "dim",
        },
      );
      rawTouches = UI.toggle("Touches", rawTouches, { id: "touches" });
    });
    if (!rawTouches) OnscreenInput.drawControls(pad); // screen space — call in draw
  },
});
