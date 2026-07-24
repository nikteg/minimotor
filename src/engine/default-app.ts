import type { App } from "./app.js";

// ---------- Global default-engine slot ----------
// The whole engine is reached as `Minimotor.*` namespaces backed by ONE default
// app built by `Stage.init()`. Game code reads these instead of importing an
// app instance. `createApp()` (app.ts) stays for isolated instances (tests).
//
// The slot lives here so `Stage`, `Loop`, `Draw`, `Keys` and `Pointer` — now in
// their own files — all share it through these accessors rather than a binding
// none of them could reassign across modules.

let current: App | null = null;

/** The default app, or `null` before `Stage.init`. */
export function getDefaultApp(): App | null {
  return current;
}

/** Install (or clear) the default app — used by `Stage.init`. */
export function setDefaultApp(g: App | null): void {
  current = g;
}

/** Clear the default-app slot if `g` holds it — called from an app's own
 *  `destroy()` in app.ts, which can't reassign this imported binding. */
export function clearDefaultApp(g: App): void {
  if (current === g) current = null;
}

export function requireDefault(): App {
  if (!current) {
    throw new Error(
      "Minimotor: call Minimotor.Stage.init(canvas) before using Stage / Loop / Keys / Pointer / Draw",
    );
  }
  return current;
}
