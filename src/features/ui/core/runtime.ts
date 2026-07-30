// ---------- UI runtime ----------
// All mutable UI state — focus, layout stacks, scroll offsets, open editors,
// gesture tracking — lives on a UiRuntime rather than at module scope, so two
// independent games on one page (`createApp` twice) each get a
// fully isolated UI. The unbound runtime supports headless state and tests;
// `UI.begin(ctx)` switches to the runtime for that explicit context. Widget
// modules never see the runtime directly: they hold their state in a
// `runtimeSlot`, which reads/creates the module's state on whichever runtime
// is current.
//
// Deliberately GLOBAL (shared by every runtime): the theme, the base-size/
// ui-scale settings, and the lifecycle hook registries (those are module
// wiring — the functions themselves operate on the current runtime's slots).

import { type Runtime, appForCanvas } from "../../../engine/index.js";
import type { GamepadState } from "../../../input/gamepad.js";

/** One isolated UI instance: the host context it draws to (null = the default
 *  app's) and the per-module state slots (see `runtimeSlot`). */
export interface UiRuntime {
  /** The context this runtime draws to; null means unbound/headless. */
  host: CanvasRenderingContext2D | null;
  /** Per-module state, indexed by each `runtimeSlot`'s id. */
  slots: unknown[];
  /** The app this runtime's frame-lifecycle hooks are registered on, or null
   *  when unwired. Held as the APP rather than a boolean so that replacing it
   *  (a destroyed or replaced app) is detectable —
   *  `ensureWired` re-attaches instead of leaving the UI kernel dead. */
  wiredTo: Runtime | null;
  /** Navigation pads for this UI instance. */
  gamepads: () => readonly GamepadState[];
}

const noGamepads = (): readonly GamepadState[] => [];
const defaultRuntime: UiRuntime = { host: null, slots: [], wiredTo: null, gamepads: noGamepads };
let current: UiRuntime = defaultRuntime;
const byCtx = new WeakMap<CanvasRenderingContext2D, UiRuntime>();

/** Every runtime created on this page (bounded by the number of distinct UIs)
 *  — for routing window-level keyboard events to the right focus machine. */
export const allRuntimes: UiRuntime[] = [defaultRuntime];

/** The active runtime — what `UI.begin` last selected, else the default. */
export function currentRuntime(): UiRuntime {
  return current;
}

/** The unbound runtime used before an explicit context is selected. */
export function defaultUiRuntime(): UiRuntime {
  return defaultRuntime;
}

/** The runtime for `ctx`, created on first use. */
export function runtimeFor(ctx: CanvasRenderingContext2D | null): UiRuntime {
  if (!ctx) return defaultRuntime;
  const existing = byCtx.get(ctx);
  if (existing) return existing;
  const rt: UiRuntime = { host: ctx, slots: [], wiredTo: null, gamepads: noGamepads };
  byCtx.set(ctx, rt);
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

/** The app hosting the current runtime: the host context's app when it has
 *  one. Null for unbound/offscreen contexts. */
export function uiApp(): Runtime | null {
  const host = current.host;
  if (host) {
    const g = appForCanvas(host.canvas);
    if (g) return g;
  }
  return null;
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
