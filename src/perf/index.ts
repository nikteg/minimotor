// ---------- Performance monitoring HUD ----------
// Lightweight FPS / frame-time tracker with optional on-canvas overlay, plus an
// optional network throughput meter. Tracks rolling min/max/avg over a window.
// Split by concern: tracker / net-meter / sparkline / hud / plugin.
export * from "./tracker.js";
export * from "./net-meter.js";
export * from "./sparkline.js";
export * from "./hud.js";
export * from "./plugin.js";
