// ---------- Debug overlay ----------
// One opt-in plugin owns the common development HUD progression:
//   none → performance → performance + world collision → none.

import type { LadderSource, MoverBody, Solid, SolidSource } from "@src/collision/index.js";
import type { CameraLens } from "@src/camera/index.js";
import type { App, Rect } from "@src/engine/index.js";
import { createInspector, type Inspection } from "./inspector.js";
import { plugin as perfPlugin, type PerfOptions } from "@src/perf/index.js";

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
  /** Run once per rendered frame, after `draw`: poll the shortcut and paint the
   *  overlay. `createDebug` subscribes this with `app.onFrame`. */
  frame(app: App): void;
}

export interface DebugApi {
  readonly mode: DebugMode;
  cycle(): DebugMode;
  watch(name: string, read: () => unknown): () => void;
  snapshot(): Record<string, unknown>;
  readonly entries: readonly Inspection[];
}

const modes: readonly DebugMode[] = ["off", "performance", "collision"];

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

/** Install the `?` debug cycle. `KeyboardEvent.key` is used deliberately, so
 * both US Shift+/ and Swedish Shift+Plus produce the same shortcut. Native UI
 * inputs keep the key and never cycle the game overlay. */
function debugPlugin(opts: DebugOptions): DebugPlugin {
  const perf = opts.perf === false ? null : perfPlugin(opts.perf);
  const camera = opts.camera;
  let index = Math.max(0, modes.indexOf(opts.initial ?? "off"));
  let shortcutDown = false;

  const cycle = (): DebugMode => {
    index = (index + 1) % modes.length;
    const mode = modes[index];
    opts.onModeChange?.(mode);
    return mode;
  };
  return {
    get mode() {
      return modes[index];
    },
    cycle,
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
    },
  };
}

/** App-owned debug overlays and runtime inspection. */
export function createDebug(app: App, opts: DebugOptions = {}): DebugApi {
  const plugin = debugPlugin(opts);
  const inspector = createInspector();
  app.onFrame(() => plugin.frame(app));
  return {
    get mode() {
      return plugin.mode;
    },
    cycle: () => plugin.cycle(),
    watch: inspector.watch,
    snapshot: inspector.snapshot,
    get entries() {
      return inspector.entries;
    },
  };
}

export * from "./inspector.js";
