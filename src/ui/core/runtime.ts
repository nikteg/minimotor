// ---------- UI runtime ----------
// All mutable UI state — focus, layout stacks, scroll offsets, open editors,
// gesture tracking — lives on a UiRuntime rather than at module scope, so two
// independent games on one page (`Stage.init` + `Stage.create`) each get a
// fully isolated UI. The default runtime backs the default game; `UI.begin(ctx)`
// switches to (creating on first use) the runtime for that context. Widget
// modules never see the runtime directly: they hold their state in a
// `runtimeSlot`, which reads/creates the module's state on whichever runtime
// is current.
//
// Deliberately GLOBAL (shared by every runtime): the theme, the base-size/
// ui-scale settings, and the lifecycle hook registries (those are module
// wiring — the functions themselves operate on the current runtime's slots).

import { type Game, gameForCanvas, getDefaultGame } from "../../engine/index.js";

/** One isolated UI instance: the host context it draws to (null = the default
 *  game's) and the per-module state slots (see `runtimeSlot`). */
export interface UiRuntime {
  /** The context this runtime draws to; null means "the default game's". */
  host: CanvasRenderingContext2D | null;
  /** Per-module state, indexed by each `runtimeSlot`'s id. */
  slots: unknown[];
  /** Frame-lifecycle hooks registered on this runtime's host loop. */
  wired: boolean;
}

const defaultRuntime: UiRuntime = { host: null, slots: [], wired: false };
let current: UiRuntime = defaultRuntime;
const byCtx = new WeakMap<CanvasRenderingContext2D, UiRuntime>();

/** Every runtime created on this page (bounded by the number of distinct UIs)
 *  — for routing window-level keyboard events to the right focus machine. */
export const allRuntimes: UiRuntime[] = [defaultRuntime];

/** The active runtime — what `UI.begin` last selected, else the default. */
export function currentRuntime(): UiRuntime {
  return current;
}

/** The default game's runtime. */
export function defaultUiRuntime(): UiRuntime {
  return defaultRuntime;
}

/** The runtime for `ctx`, created on first use. The default game's own
 *  context maps to the default runtime, so `begin(Draw.ctx)` is a no-op. */
export function runtimeFor(ctx: CanvasRenderingContext2D | null): UiRuntime {
  if (!ctx) return defaultRuntime;
  const existing = byCtx.get(ctx);
  if (existing) return existing;
  if (getDefaultGame()?.ctx === ctx) return defaultRuntime;
  const rt: UiRuntime = { host: ctx, slots: [], wired: false };
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

/** The game hosting the current runtime: the host context's game when it has
 *  one, else the default game (also the fallback for offscreen contexts that
 *  belong to no game). Null before any game exists (headless/tests). */
export function uiGame(): Game | null {
  const host = current.host;
  if (host) {
    const g = gameForCanvas(host.canvas);
    if (g) return g;
  }
  return getDefaultGame();
}

/** Drop every runtime's state and return to the default runtime — for tests
 *  (see lifecycle `_reset`). Run widget `onReset` hooks FIRST: some state
 *  owns DOM nodes (native editors) that a plain slot wipe would leak. */
export function resetRuntimes(): void {
  for (const rt of allRuntimes) {
    rt.slots.length = 0;
    rt.wired = false;
  }
  current = defaultRuntime;
}
