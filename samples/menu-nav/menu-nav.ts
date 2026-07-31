// Menu Nav — a full options screen and a test bed for UI navigation.
//
// Navigation, three ways (they all drive the same focus machine):
//   • Keyboard: Tab / Shift+Tab move focus, Enter/Space activate, ← → adjust;
//     Q/E switch the top tabs, Z/X the sub-tabs.
//   • Gamepad: D-pad or LEFT STICK move focus, A activates, ← → adjust;
//     LB/RB (bumpers) switch the top tabs, LT/RT (triggers) the sub-tabs.
//   • Pointer: click anything.
//
// The on-screen pad is drawn like a real controller — left stick, a D-pad to its
// right, an A face button, and the LB/RB/LT/RT shoulders above. Every pad
// registered with Input automatically participates in UI navigation.
import { createInput } from "minimotor/input";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createUI } from "minimotor/ui";
import { createApp } from "minimotor";
import { installLayoutProbe } from "../shared/layout-probe.ts";

const game = createApp("game", {
  fullscreen: true,
  background: "#12141c",
  preventNavigation: true,
});
const { Draw, Keys, Loop } = game;
const Input = createInput(game);
const UI = createUI(game, Input);
installLayoutProbe(UI);
const OnscreenInput = createOnscreenInput(game, Input, UI);
const uiId = UI.ids("menu-nav");

const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  // Left analog stick — moves focus.
  stick: { anchor: { side: "left", x: 92, y: 92 }, radius: 56 },
  buttons: [
    // D-pad, to the RIGHT of the left stick.
    { anchor: { side: "left", x: 252, y: 134 }, r: 24, button: "dpad-up", label: "▲" },
    { anchor: { side: "left", x: 252, y: 50 }, r: 24, button: "dpad-down", label: "▼" },
    { anchor: { side: "left", x: 208, y: 92 }, r: 24, button: "dpad-left", label: "◀" },
    { anchor: { side: "left", x: 296, y: 92 }, r: 24, button: "dpad-right", label: "▶" },
    // A face button, bottom-right.
    { anchor: { side: "right", x: 92, y: 92 }, r: 38, button: "a", label: "A" },
    // Shoulders (LB/RB) + triggers (LT/RT), rendered ABOVE the stick/buttons.
    { anchor: { side: "left", x: 96, y: 250 }, r: 28, button: "l1", label: "LB" },
    { anchor: { side: "left", x: 96, y: 314 }, r: 28, button: "l2", label: "LT" },
    { anchor: { side: "right", x: 96, y: 250 }, r: 28, button: "r1", label: "RB" },
    { anchor: { side: "right", x: 96, y: 314 }, r: 28, button: "r2", label: "RT" },
  ],
});
const TABS = [
  { name: "Video", subs: ["Display", "Quality"] },
  { name: "Audio", subs: ["Levels", "Output"] },
  { name: "Controls", subs: ["Gamepad", "Keybinds"] },
  { name: "Gameplay", subs: ["General", "HUD"] },
];

let tab = 0;
let sub = 0;

// Option state — the immediate-mode round-trip target for each widget.
let resolution = "1920 × 1080";
let fullscreen = true;
let vsync = false;
let preset = "high";
let shadows = true;
let aa = "taa";
let master = 80;
let music = 60;
let sfx = 70;
let audioDevice = "system";
let mono = false;
let sensitivity = 5;
let invertY = false;
let difficulty = "normal";
let tutorials = true;
let hudOpacity = 90;
let minimap = true;
let lastAction = "—";

const Buttons = Input.Buttons;

// Draw the widgets for the active tab + sub-tab. Each widget is focusable, so the
// D-pad / stick / Tab walk them and ← → / A adjust or activate.
function renderOptions(): void {
  const key = `${TABS[tab].name}/${TABS[tab].subs[sub]}`;
  switch (key) {
    case "Video/Display":
      UI.text("Resolution", { color: "dim", size: 12 });
      resolution = UI.select({
        id: uiId("res"),
        value: resolution,
        options: ["2560 × 1440", "1920 × 1080", "1280 × 720"].map((v) => ({ label: v, value: v })),
        ariaLabel: "Resolution",
      }).value;
      fullscreen = UI.toggle({ id: uiId("fullscreen"), label: "Fullscreen", on: fullscreen });
      vsync = UI.toggle({ id: uiId("vsync"), label: "V-Sync", on: vsync });
      break;
    case "Video/Quality":
      UI.text("Preset", { color: "dim", size: 12 });
      preset = UI.select({
        id: uiId("preset"),
        value: preset,
        options: [
          { label: "Low", value: "low" },
          { label: "Medium", value: "medium" },
          { label: "High", value: "high" },
          { label: "Ultra", value: "ultra" },
        ],
        ariaLabel: "Quality preset",
      }).value;
      shadows = UI.toggle({ id: uiId("shadows"), label: "Shadows", on: shadows });
      UI.text("Anti-aliasing", { color: "dim", size: 12 });
      aa = UI.select({
        id: uiId("aa"),
        value: aa,
        options: [
          { label: "Off", value: "off" },
          { label: "FXAA", value: "fxaa" },
          { label: "TAA", value: "taa" },
        ],
        ariaLabel: "Anti-aliasing",
      }).value;
      break;
    case "Audio/Levels":
      master = UI.slider({ id: uiId("master"), label: "Master", value: master, min: 0, max: 100 });
      music = UI.slider({ id: uiId("music"), label: "Music", value: music, min: 0, max: 100 });
      sfx = UI.slider({ id: uiId("sfx"), label: "SFX", value: sfx, min: 0, max: 100 });
      break;
    case "Audio/Output":
      UI.text("Device", { color: "dim", size: 12 });
      audioDevice = UI.select({
        id: uiId("device"),
        value: audioDevice,
        options: [
          { label: "System default", value: "system" },
          { label: "Headphones", value: "phones" },
          { label: "Speakers", value: "speakers" },
        ],
        ariaLabel: "Output device",
      }).value;
      mono = UI.toggle({ id: uiId("mono"), label: "Mono downmix", on: mono });
      break;
    case "Controls/Gamepad":
      sensitivity = UI.slider({
        id: uiId("sens"),
        label: "Aim sens",
        value: sensitivity,
        min: 1,
        max: 10,
        step: 1,
        format: (v) => `${Math.round(v)}`,
      });
      invertY = UI.toggle({ id: uiId("invert"), label: "Invert Y", on: invertY });
      break;
    case "Controls/Keybinds":
      if (UI.button({ id: uiId("bind-jump"), label: "Jump — Space" })) lastAction = "Rebind Jump";
      if (UI.button({ id: uiId("bind-fire"), label: "Fire — L-Click" })) lastAction = "Rebind Fire";
      if (UI.button({ id: uiId("bind-reset"), label: "Reset to defaults", variant: "danger" }))
        lastAction = "Reset binds";
      break;
    case "Gameplay/General":
      UI.text("Difficulty", { color: "dim", size: 12 });
      difficulty = UI.select({
        id: uiId("difficulty"),
        value: difficulty,
        options: [
          { label: "Story", value: "story" },
          { label: "Normal", value: "normal" },
          { label: "Hard", value: "hard" },
        ],
        ariaLabel: "Difficulty",
      }).value;
      tutorials = UI.toggle({ id: uiId("tutorials"), label: "Show tutorials", on: tutorials });
      break;
    case "Gameplay/HUD":
      hudOpacity = UI.slider({
        id: uiId("hud"),
        label: "HUD opacity",
        value: hudOpacity,
        min: 0,
        max: 100,
        format: (v) => `${Math.round(v)}%`,
      });
      minimap = UI.toggle({ id: uiId("minimap"), label: "Minimap", on: minimap });
      break;
  }
}

Loop.run({
  update() {
    // Bumpers / Q-E switch top tabs; triggers / Z-X switch sub-tabs. Read the
    // pad edges in the fixed step (that's where `pressed` is one-shot).
    const nTabs = TABS.length;
    if (pad.pressed(Buttons.R1) || Keys.pressed("KeyE")) {
      tab = (tab + 1) % nTabs;
      sub = 0;
    }
    if (pad.pressed(Buttons.L1) || Keys.pressed("KeyQ")) {
      tab = (tab - 1 + nTabs) % nTabs;
      sub = 0;
    }
    const nSubs = TABS[tab].subs.length;
    if (pad.pressed(Buttons.R2) || Keys.pressed("KeyX")) sub = (sub + 1) % nSubs;
    if (pad.pressed(Buttons.L2) || Keys.pressed("KeyZ")) sub = (sub - 1 + nSubs) % nSubs;
  },

  draw() {
    Draw.text("OPTIONS", { x: 24, y: 18, color: "#e7ecf0", font: "bold 22px monospace" });
    Draw.text("LB/RB or Q/E: tab · LT/RT or Z/X: sub-tab · stick/D-pad: move · A/Enter: select", {
      x: 24,
      y: 46,
      size: 12,
      color: "#8b94a0",
    });

    UI.idScope("opt", () => {
      UI.col({ x: 24, y: 82, w: 440, gap: 12 }, () => {
        // Tabs + sub-tabs are in the tab order too: Tab / D-pad reach them and
        // ← → switch the focused strip (a focused UI.tabs cycles on arrows). The
        // LB/RB · LT/RT · Q/E/Z/X shortcuts still jump straight regardless of focus.
        tab = UI.tabs({
          id: uiId("tabs"),
          items: TABS.map((t) => t.name),
          active: tab,
          w: 440,
        });
        sub = Math.min(sub, TABS[tab].subs.length - 1);
        sub = UI.tabs({
          id: uiId("subtabs"),
          items: TABS[tab].subs,
          active: sub,
          w: 440,
        });
        UI.panel({ title: `${TABS[tab].name} · ${TABS[tab].subs[sub]}`, gap: 10 }, renderOptions);
      });
    });

    UI.text(`Focused: ${UI.focusedId() ?? "—"}`, { x: 24, y: 470, size: 13, color: "dim" });
    UI.text(`Last activated: ${lastAction}`, { x: 24, y: 494, size: 13, color: "accent" });

    OnscreenInput.drawControls(pad);
    UI.drawTips();
  },
});
