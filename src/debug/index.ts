// ---------- Debug overlay ----------
// One opt-in plugin owns the common development HUD progression:
//   none → performance → performance + world collision → none.

import type { LadderSource, MoverBody, Solid, SolidSource } from "@src/collision/index.js";
import type { CameraLens } from "@src/camera/index.js";
import type { App, Rect } from "@src/engine/index.js";
import { createInspector, type Inspection } from "./inspector.js";
import { plugin as perfPlugin, type Perf3DSource, type PerfOptions } from "@src/perf/index.js";
import type { NetMeter } from "@src/perf/net-meter.js";

export type DebugMode = "off" | "performance" | "collision";

export interface DebugWorld extends SolidSource, Partial<LadderSource> {}

export interface DebugOptions {
  /** Queryable collision world to visualize in the full debug mode. */
  world?: DebugWorld | (() => DebugWorld);
  /** Live movers to outline in the full debug mode. */
  bodies?: () => Iterable<Rect | MoverBody>;
  /** Performance HUD options. Pass `false` to omit it. */
  perf?: PerfOptions | false;
  /** Camera used to draw/query world collision. */
  camera?: CameraLens;
  /** Initial mode. Default `"off"`. */
  initial?: DebugMode;
  /** Called after the mode changes, including shortcut-driven changes. */
  onModeChange?(mode: DebugMode): void;
}

export interface DebugPlugin {
  readonly mode: DebugMode;
  cycle(): DebugMode;
  set3dRenderer(renderer: Perf3DSource | null): void;
  setNetMeter(meter: NetMeter | null): void;
  /** Run once per rendered frame, after `draw`: poll the shortcut and paint the
   *  overlay. `createDebug` subscribes this with `app.onFrame`. */
  frame(app: App): void;
}

export interface DebugApi {
  readonly mode: DebugMode;
  cycle(): DebugMode;
  /** Attach or replace the renderer reported by the performance mode. */
  set3dRenderer(renderer: Perf3DSource | null): void;
  /** Point the perf HUD's throughput readings at a `NetMeter`, or null for
   *  none. A game's room is opened long after its debug overlay is installed,
   *  and every rejoin makes a new meter — so, like `set3dRenderer`, this is a
   *  setter rather than a constructor argument. No-op with `perf: false`. */
  setNetMeter(meter: NetMeter | null): void;
  watch(name: string, read: () => unknown): () => void;
  snapshot(): Record<string, unknown>;
  readonly entries: readonly Inspection[];
}

const allModes: readonly DebugMode[] = ["off", "performance", "collision"];

function drawSolid(ctx: CanvasRenderingContext2D, solid: Solid): void {
  ctx.beginPath();
  if (solid.slope === "up-right") {
    ctx.moveTo(solid.x, solid.y + solid.h);
    ctx.lineTo(solid.x + solid.w, solid.y);
    ctx.lineTo(solid.x + solid.w, solid.y + solid.h);
    ctx.closePath();
  } else if (solid.slope === "up-left") {
    ctx.moveTo(solid.x, solid.y);
    ctx.lineTo(solid.x + solid.w, solid.y + solid.h);
    ctx.lineTo(solid.x, solid.y + solid.h);
    ctx.closePath();
  } else if (solid.oneWay) {
    ctx.moveTo(solid.x, solid.y);
    ctx.lineTo(solid.x + solid.w, solid.y);
  } else {
    ctx.rect(solid.x, solid.y, solid.w, solid.h);
  }
  ctx.fillStyle = solid.oneWay ? "rgba(255, 210, 80, .14)" : "rgba(60, 220, 255, .12)";
  if (!solid.oneWay || solid.slope) ctx.fill();
  ctx.strokeStyle = solid.oneWay ? "#ffd250" : "#3cdcff";
  ctx.stroke();
}

/** Draw collision geometry for a queryable world and optional movers.
 * Usually `createDebug(app)` calls this for you. */
export function collision(
  ctx: CanvasRenderingContext2D,
  world: DebugWorld,
  view: Rect,
  bodies: Iterable<Rect | MoverBody> = [],
): void {
  const solids: Solid[] = [];
  world.solidsNear(view, solids);
  for (const solid of solids) drawSolid(ctx, solid);

  if (world.laddersNear) {
    const ladders: Rect[] = [];
    world.laddersNear(view, ladders);
    ctx.strokeStyle = "#7dff83";
    ctx.setLineDash([2, 2]);
    for (const ladder of ladders) ctx.strokeRect(ladder.x, ladder.y, ladder.w, ladder.h);
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = "#ff5ad9";
  for (const body of bodies) ctx.strokeRect(body.x, body.y, body.w, body.h);
}

/** Install the `?`/four-finger debug cycle. `KeyboardEvent.key` is used
 * deliberately, so both US Shift+/ and Swedish Shift+Plus produce the same
 * shortcut. Native UI inputs keep the key and never cycle the game overlay.
 * Four simultaneous touch pointers provide the same shortcut on iPad/iPhone. */
function debugPlugin(app: App, opts: DebugOptions): DebugPlugin {
  const perf = opts.perf === false ? null : perfPlugin(opts.perf);
  const camera = opts.camera;
  let render3d: Perf3DSource | null = null;
  const modes = opts.world && camera ? allModes : allModes.slice(0, 2);
  const requestedInitial = opts.initial ?? "off";
  const initialIndex = modes.indexOf(requestedInitial);
  let index = initialIndex >= 0 ? initialIndex : modes.indexOf("performance");
  let shortcutDown = false;
  const touchPointers = new Set<number>();
  let touchCycleFired = false;
  let firstTouchAt = Number.NEGATIVE_INFINITY;

  const cycle = (): DebugMode => {
    index = (index + 1) % modes.length;
    const mode = modes[index];
    opts.onModeChange?.(mode);
    return mode;
  };
  // Pointer events preserve one pointerId per finger even though the app's
  // public Pointer state intentionally collapses gameplay input to one point.
  // Keep this gesture private to the debug layer so normal game/UI input does
  // not acquire multi-touch semantics just for a developer shortcut.
  const onTouchPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    const now = performance.now();
    if (touchPointers.size === 0) firstTouchAt = now;
    touchPointers.add(event.pointerId);
    if (touchPointers.size >= 4 && now - firstTouchAt <= 500 && !touchCycleFired) {
      touchCycleFired = true;
      cycle();
    }
  };
  const onTouchPointerEnd = (event: PointerEvent): void => {
    if (event.pointerType !== "touch") return;
    touchPointers.delete(event.pointerId);
    if (touchPointers.size === 0) {
      firstTouchAt = Number.NEGATIVE_INFINITY;
      touchCycleFired = false;
    }
  };
  // The guard also keeps the debug plugin usable with lightweight App mocks
  // in tests and tooling that only exercise the keyboard cycle.
  const canvas = app.canvas;
  if (canvas) {
    canvas.addEventListener("pointerdown", onTouchPointerDown);
    window.addEventListener("pointerup", onTouchPointerEnd);
    window.addEventListener("pointercancel", onTouchPointerEnd);
    app.onDestroy(() => {
      canvas.removeEventListener("pointerdown", onTouchPointerDown);
      window.removeEventListener("pointerup", onTouchPointerEnd);
      window.removeEventListener("pointercancel", onTouchPointerEnd);
    });
  }
  return {
    get mode() {
      return modes[index];
    },
    cycle,
    set3dRenderer(renderer) {
      render3d = renderer;
      perf?.set3dRenderer(renderer);
    },
    setNetMeter(meter) {
      perf?.setNet(meter);
    },
    frame(app) {
      // The shortcut is edge-detected here rather than in a fixed step so it
      // still works while the loop is paused — `onFrame` runs on paused frames.
      const down = app.Keys.keyDown("?");
      if (down && !shortcutDown) cycle();
      shortcutDown = down;

      if (modes[index] === "collision" && opts.world && camera) {
        const world = typeof opts.world === "function" ? opts.world() : opts.world;
        const view = camera.rect;
        app.ctx.save();
        camera.render(() => {
          app.ctx.lineWidth = 1 / Math.max(camera.zoom, 0.0001);
          collision(app.ctx, world, view, opts.bodies?.());
        });
        app.ctx.restore();
      }
      if (modes[index] !== "off") perf?.frame(app);
      else {
        // Keep renderer-owned counters bounded while the debug overlay is
        // hidden. The next visible frame should describe that frame, not the
        // entire time spent with the overlay disabled.
        render3d?.consumeFrameStats();
      }
    },
  };
}

/** App-owned debug overlays and runtime inspection. */
export function createDebug(app: App, opts: DebugOptions = {}): DebugApi {
  const plugin = debugPlugin(app, opts);
  const inspector = createInspector();
  app.onFrame(() => plugin.frame(app));
  return {
    get mode() {
      return plugin.mode;
    },
    cycle: () => plugin.cycle(),
    set3dRenderer: (renderer) => plugin.set3dRenderer(renderer),
    setNetMeter: (meter) => plugin.setNetMeter(meter),
    watch: inspector.watch,
    snapshot: inspector.snapshot,
    get entries() {
      return inspector.entries;
    },
  };
}

export * from "./inspector.js";
