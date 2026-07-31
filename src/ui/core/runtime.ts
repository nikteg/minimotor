// ---------- UI runtime ----------
// All mutable UI state — focus, layout stacks, scroll offsets, open editors,
// gesture tracking — lives on a UiRuntime rather than at module scope, so two
// independent games on one page (`createApp` twice) each get a
// fully isolated UI. The unbound runtime supports headless state and tests.
// `createUI` builds one runtime per app and wraps every function it hands out
// in `withRuntime`, so `current` is always the one that call belongs to. Widget
// modules never see the runtime directly: they hold their state in a
// `runtimeSlot`, which reads/creates the module's state on whichever runtime
// is current.
//
// Deliberately GLOBAL (shared by every runtime): the theme, the base-size/
// ui-scale settings, and the lifecycle hook registries (those are module
// wiring — the functions themselves operate on the current runtime's slots).

import type { App } from "../../engine/index.js";
import type { GamepadState } from "../../input/gamepad.js";

/** What the widgets actually need from the app hosting them — a slice of
 *  `App`, not the whole thing, so the requirement is stated rather than
 *  assumed. Null on an offscreen/headless runtime, and every widget reads it
 *  as optional (`uiApp()?.viewport`), so an unbound runtime degrades. */
export type UiHost = Pick<
  App,
  "ctx" | "viewport" | "Pointer" | "Loop" | "resetTransform" | "setCursor" | "onStep" | "onFrame"
>;

/** One isolated UI instance: the host context it draws to (null = the default
 *  app's) and the per-module state slots (see `runtimeSlot`). */
export interface UiRuntime {
  /** The context this runtime draws to; null means unbound/headless. */
  host: CanvasRenderingContext2D | null;
  /** The app this runtime draws for — supplied by `createUI`, since that is
   *  where a UI and an app are joined. Null for offscreen/headless contexts,
   *  and every widget reads it as optional (`uiApp()?.viewport`), so an
   *  unbound runtime degrades instead of failing. */
  app: UiHost | null;
  /** Per-module state, indexed by each `runtimeSlot`'s id. */
  slots: unknown[];
  /** The app this runtime's frame-lifecycle hooks are registered on, or null
   *  when unwired. Held as the APP rather than a boolean so that replacing it
   *  (a destroyed or replaced app) is detectable —
   *  `ensureWired` re-attaches instead of leaving the UI kernel dead. */
  wiredTo: UiHost | null;
  /** Navigation pads for this UI instance. */
  gamepads: () => readonly GamepadState[];
}

const noGamepads = (): readonly GamepadState[] => [];
const defaultRuntime: UiRuntime = {
  host: null,
  app: null,
  slots: [],
  wiredTo: null,
  gamepads: noGamepads,
};
let current: UiRuntime = defaultRuntime;

/** Every runtime created on this page (bounded by the number of distinct UIs)
 *  — for routing window-level keyboard events to the right focus machine. */
export const allRuntimes: UiRuntime[] = [defaultRuntime];

/** The active runtime — whichever `withRuntime` is in scope, else the default. */
export function currentRuntime(): UiRuntime {
  return current;
}

/** The unbound runtime used before an explicit context is selected. */
export function defaultUiRuntime(): UiRuntime {
  return defaultRuntime;
}

/** Build the UI runtime for one context. `createUI` calls this once per app and
 *  holds the result — there is no registry to look it up in later, because the
 *  only thing that ever needed to find it is the thing that made it. A null
 *  `ctx` (headless) shares the unbound default runtime. */
export function createUiRuntime(
  ctx: CanvasRenderingContext2D | null,
  app: UiHost | null = null,
): UiRuntime {
  if (!ctx) return defaultRuntime;
  const rt: UiRuntime = { host: ctx, app, slots: [], wiredTo: null, gamepads: noGamepads };
  allRuntimes.push(rt);
  return rt;
}

/** Make `rt` current; returns the previous runtime (restore it yourself, or
 *  use `withRuntime`). */
export function switchRuntime(rt: UiRuntime): UiRuntime {
  const prev = current;
  current = rt;
  return prev;
}

/** Run `fn` with `rt` current, restoring the previous runtime after. */
export function withRuntime<R>(rt: UiRuntime, fn: () => R): R {
  const prev = switchRuntime(rt);
  try {
    return fn();
  } finally {
    current = prev;
  }
}

let nextSlot = 0;

/** Reserve a per-runtime state slot for a module. Call at module scope; the
 *  returned accessor reads (lazily creating via `init`) the CURRENT runtime's
 *  instance of the state:
 *
 *    const state = runtimeSlot(() => ({ drag: null as Drag | null }));
 *    ...
 *    state().drag = ...;   // always the current runtime's copy */
export function runtimeSlot<T>(init: () => T): () => T {
  const slot = nextSlot++;
  return () => {
    const slots = current.slots;
    let v = slots[slot];
    if (v === undefined) {
      v = init();
      slots[slot] = v;
    }
    return v as T;
  };
}

/** The app hosting the current runtime. Null for unbound/offscreen contexts. */
export function uiApp(): UiHost | null {
  return current.app;
}

/** Drop every runtime's state and return to the default runtime — for tests
 *  (see lifecycle `_reset`). Run widget `onReset` hooks FIRST: some state
 *  owns DOM nodes (native editors) that a plain slot wipe would leak. */
export function resetRuntimes(): void {
  for (const rt of allRuntimes) {
    rt.slots.length = 0;
    rt.wiredTo = null;
  }
  current = defaultRuntime;
}
