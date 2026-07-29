import type { App } from "./app.js";

// ---------- Global default-engine slot ----------
// The whole engine is reached as `Minimotor.*` namespaces backed by ONE default
// app built by `App.init()`. Application code reads these instead of importing
// an app instance. `createApp()` (app.ts) stays for isolated instances (tests).
//
// The slot lives here so `App`, `Loop`, `Draw`, `Keys` and `Pointer` — now in
// their own files — all share it through these accessors rather than a binding
// none of them could reassign across modules.

let current: App | null = null;

// Module-level wiring that hangs handlers off the DEFAULT app's loop (the
// Clock timer driver, for one) registered them on whatever app was current at
// the time. `App.init` tears that app down and installs a new one, taking the
// old registrations with it — so anything holding such a registration has to
// hear about the swap and re-attach, or it goes silently dead. Subscribers are
// module-scope and few; the set never grows with app churn.
const changeHandlers = new Set<() => void>();

/** Notified whenever the default app is installed, replaced or cleared (i.e.
 *  from `App.init` and from an app's own `destroy()`). For module-level wiring
 *  that must re-attach to the new app's loop. Returns unsubscribe. */
export function onDefaultAppChange(handler: () => void): () => void {
  changeHandlers.add(handler);
  return () => changeHandlers.delete(handler);
}

function notifyChange(): void {
  for (const handler of changeHandlers) handler();
}

/** The default app, or `null` before `App.init`. */
export function getDefaultApp(): App | null {
  return current;
}

/** Install (or clear) the default app — used by `App.init`. */
export function setDefaultApp(g: App | null): void {
  if (current === g) return;
  current = g;
  notifyChange();
}

/** Clear the default-app slot if `g` holds it — called from an app's own
 *  `destroy()` in app.ts, which can't reassign this imported binding. */
export function clearDefaultApp(g: App): void {
  if (current !== g) return;
  current = null;
  notifyChange();
}

export function requireDefault(): App {
  if (!current) {
    throw new Error(
      "Minimotor: call Minimotor.App.init(canvas) before using App / Loop / Keys / Pointer / Draw",
    );
  }
  return current;
}
