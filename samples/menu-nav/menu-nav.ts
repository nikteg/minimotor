// Menu Nav — a focus-navigation test bed for the immediate-mode UI.
//
// Every widget below is keyboard- AND gamepad-focusable. Move focus with Tab /
// Shift+Tab or the D-pad ↑↓; activate with Enter / Space / the A button; adjust
// the slider (and cycle the select) with ← → or the D-pad ←→. The status lines
// show which widget holds focus and what was last activated.
//
// The trick for touch: `OnscreenInput.gamepad` only *feeds* a pad — it doesn't
// automatically drive UI focus. `UI.setNavPad(pad)` routes UI focus navigation
// through it, so the on-screen D-pad walks the menu just like a hardware pad.
import { Draw, Loop, OnscreenInput, Stage, UI } from "minimotor";

Stage.init("game", { fullscreen: true, background: "#12141c", preventNavigation: true });

// A D-pad cluster (left) + an A button (right). `button` names feed the standard
// `pad:` bindings the focus navigator reads (dpad-up/down/left/right, a).
const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  buttons: [
    { anchor: { side: "left", x: 116, y: 196 }, r: 30, button: "dpad-up", label: "▲" },
    { anchor: { side: "left", x: 116, y: 76 }, r: 30, button: "dpad-down", label: "▼" },
    { anchor: { side: "left", x: 56, y: 136 }, r: 30, button: "dpad-left", label: "◀" },
    { anchor: { side: "left", x: 176, y: 136 }, r: 30, button: "dpad-right", label: "▶" },
    { anchor: { side: "right", x: 100, y: 120 }, r: 42, button: "a", label: "A" },
  ],
});
// Route UI focus navigation through the on-screen pad (fused with hardware pad 0),
// so its D-pad moves focus and A activates.
UI.setNavPad(pad);

// Menu state — the immediate-mode round-trip target for each widget.
let sound = true;
let showFps = false;
let volume = 60;
let quality = "high";
let lastAction = "—";

Loop.run({
  update() {
    // No simulation — the menu is drawn entirely from widget state.
  },

  draw() {
    Draw.text("MENU NAV", {
      x: 24,
      y: 18,
      size: 22,
      color: "#e7ecf0",
      font: "bold 22px monospace",
    });
    Draw.text("Tab / D-pad ↑↓ move · Enter / A activate · ←→ adjust", {
      x: 24,
      y: 46,
      size: 12,
      color: "#8b94a0",
    });

    // A column of focusable widgets. No explicit ids — `idScope` gives them
    // stable call-order ids so focus sticks frame-to-frame.
    UI.idScope("menu", () => {
      UI.group({ x: 24, y: 80, w: 320, title: "MAIN MENU", gap: 10 }, () => {
        if (UI.button({ label: "Start Game", variant: "primary" })) lastAction = "Start Game";
        if (UI.button({ label: "Load" })) lastAction = "Load";
        sound = UI.toggle({ label: "Sound", on: sound });
        showFps = UI.toggle({ label: "Show FPS", on: showFps });
        volume = UI.slider({
          label: "Volume",
          value: volume,
          min: 0,
          max: 100,
          format: (v) => `${Math.round(v)}%`,
        });
        quality = UI.select({
          value: quality,
          options: [
            { label: "Low", value: "low" },
            { label: "Medium", value: "medium" },
            { label: "High", value: "high" },
            { label: "Ultra", value: "ultra" },
          ],
          ariaLabel: "Quality",
        }).value;
        if (UI.button({ label: "Quit", variant: "danger" })) lastAction = "Quit";
      });
    });

    UI.text(`Focused: ${UI.focusedId() ?? "—"}`, { x: 24, y: 440, size: 13, color: "dim" });
    UI.text(`Last activated: ${lastAction}`, { x: 24, y: 464, size: 13, color: "accent" });

    OnscreenInput.drawControls(pad);
    UI.drawTips();
  },
});
