// Two independent minimotor games on ONE page: the default game (App.init)
// on the top canvas and an isolated game (App.create) on the bottom one.
// Each frame the isolated game points the UI at its own context with
// `UI.begin(ctx)` — every widget after that hit-tests against THAT game's
// pointer and keeps its own per-canvas state (counters, toggles, tooltips,
// floating text), so the two UIs can't leak into each other.
import { Draw, Loop, App, UI } from "minimotor";

// Exposed for the e2e test: each button click bumps its own counter.
const counters = { main: 0, iso: 0 };
declare global {
  interface Window {
    __dual: typeof counters;
  }
}
window.__dual = counters;

// ---------- Game 1: the default game ----------
App.init("game", { background: "#1a1a2e" });

let mainToggle = false;
Loop.run({
  update() {},
  draw() {
    UI.text("Default game (App.init)", { x: 20, y: 14, size: 18, bold: true });
    UI.text("Widgets here only react to THIS canvas", { x: 20, y: 40, color: "dim" });
    if (
      UI.button({ id: "main-btn", x: 20, y: 70, w: 200, h: 40, label: `Clicked ${counters.main}` })
    ) {
      counters.main++;
      UI.floatText("+1", 240, 90, { color: "#4ecdc4" });
    }
    mainToggle = UI.toggle("Main toggle", mainToggle, { id: "main-toggle", x: 20, y: 130 });
    Draw.circle(300, 90, 14, mainToggle ? "#4ecdc4" : "#3a3a5e");
    UI.drawFloatText();
    UI.drawTips();
  },
});

// ---------- Game 2: an isolated game on its own canvas ----------
const g2 = App.create({ canvas: "game2", background: "#16321f" });

let isoToggle = true;
g2.run({
  update() {},
  draw() {
    UI.begin(g2.ctx); // point every UI.* call below at this game's canvas + pointer
    UI.text("Isolated game (App.create)", { x: 20, y: 14, size: 18, bold: true });
    UI.text("…and widgets here only react to this one", { x: 20, y: 40, color: "dim" });
    if (
      UI.button({ id: "iso-btn", x: 20, y: 70, w: 200, h: 40, label: `Clicked ${counters.iso}` })
    ) {
      counters.iso++;
      UI.floatText("+1", 240, 90, { color: "#ffd43b" });
    }
    isoToggle = UI.toggle("Isolated toggle", isoToggle, { id: "iso-toggle", x: 20, y: 130 });
    // Isolated games draw through their own ctx (Draw.* targets the default game).
    g2.ctx.fillStyle = isoToggle ? "#ffd43b" : "#2a4a35";
    g2.ctx.beginPath();
    g2.ctx.arc(300, 90, 14, 0, Math.PI * 2);
    g2.ctx.fill();
    UI.drawFloatText();
    UI.drawTips();
  },
});
