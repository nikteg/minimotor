// Two fully isolated games on one page. Each owns its canvas, loop, renderer,
// input, clock, and optional UI feature.
import { createApp } from "minimotor";
import { createUI } from "minimotor/ui";

// Exposed for the e2e test: each button click bumps its own counter.
const counters = { main: 0, iso: 0 };
declare global {
  interface Window {
    __dual: typeof counters;
  }
}
window.__dual = counters;

const main = createApp("game", { background: "#1a1a2e", fullscreen: false });
const { Draw: MainDraw, Loop: MainLoop } = main;
const MainUI = createUI(main);

let mainToggle = false;
MainLoop.run({
  update() {},
  draw() {
    MainUI.text("Explicit game A", { x: 20, y: 14, size: 18, bold: true });
    MainUI.text("Widgets here only react to THIS canvas", { x: 20, y: 40, color: "dim" });
    if (
      MainUI.button({
        id: "main-btn",
        x: 20,
        y: 70,
        w: 200,
        h: 40,
        label: `Clicked ${counters.main}`,
      })
    ) {
      counters.main++;
      MainUI.floatText("+1", 240, 90, { color: "#4ecdc4" });
    }
    mainToggle = MainUI.toggle("Main toggle", mainToggle, { id: "main-toggle", x: 20, y: 130 });
    MainDraw.circle(300, 90, 14, mainToggle ? "#4ecdc4" : "#3a3a5e");
    MainUI.drawFloatText();
    MainUI.drawTips();
  },
});

// ---------- Game 2: an isolated game on its own canvas ----------
const second = createApp("game2", { background: "#16321f", fullscreen: false });
const { Draw: SecondDraw, Loop: SecondLoop } = second;
const SecondUI = createUI(second);

let isoToggle = true;
SecondLoop.run({
  update() {},
  draw() {
    SecondUI.text("Explicit game B", { x: 20, y: 14, size: 18, bold: true });
    SecondUI.text("…and widgets here only react to this one", { x: 20, y: 40, color: "dim" });
    if (
      SecondUI.button({
        id: "iso-btn",
        x: 20,
        y: 70,
        w: 200,
        h: 40,
        label: `Clicked ${counters.iso}`,
      })
    ) {
      counters.iso++;
      SecondUI.floatText("+1", 240, 90, { color: "#ffd43b" });
    }
    isoToggle = SecondUI.toggle("Isolated toggle", isoToggle, { id: "iso-toggle", x: 20, y: 130 });
    SecondDraw.circle(300, 90, 14, isoToggle ? "#ffd43b" : "#2a4a35");
    SecondUI.drawFloatText();
    SecondUI.drawTips();
  },
});
