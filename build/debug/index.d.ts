import type { LadderSource, MoverBody, SolidSource } from "../collision/index.js";
import type { CameraLens } from "../camera/index.js";
import type { App, Rect } from "../engine/index.js";
import { type Inspection } from "./inspector.js";
import { type Perf3DSource, type PerfOptions } from "../perf/index.js";
import type { NetMeter } from "../perf/net-meter.js";
export type DebugMode = "off" | "performance" | "collision" | "collision-xray";
/** Extra content drawn while the overlay is visible.
 *
 *  The perf HUD answers "is the engine keeping up". A game usually has its own
 *  questions — which volume the player is standing in, what the AI thinks it is
 *  doing, a row of buttons that force a state — and those belong to the game,
 *  not here. What they should SHARE is the toggle: one shortcut turning
 *  everything development-only on and off, rather than a key per tool. */
export type DebugPanel = (app: App, mode: DebugMode) => void;
export interface DebugWorld extends SolidSource, Partial<LadderSource> {
}
export interface DebugOptions {
    /** Queryable collision world to visualize in the full debug mode. */
    world?: DebugWorld | (() => DebugWorld);
    /** Live movers to outline in the full debug mode. */
    bodies?: () => Iterable<Rect | MoverBody>;
    /** Performance HUD options. Pass `false` to omit it. */
    perf?: PerfOptions | false;
    /** Camera used to draw/query world collision. */
    camera?: CameraLens;
    /** Keep the `"collision"` mode in the cycle with no 2D `world` to draw from.
     *
     *  The mode is a SLOT — the state that means "show me what the physics thinks
     *  is there" — and `world` + `camera` is only one way to fill it. A 3D game's
     *  collision lives in a physics world this module knows nothing about, so it
     *  fills the slot itself from a `panel`, which is handed the current mode. Set
     *  this and the cycle grows a third stop that the overlay itself draws
     *  nothing into.
     *
     *  `"xray"` asks for TWO such stops rather than one: `"collision"`, which the
     *  game should draw the way the camera sees it, and `"collision-xray"`, which
     *  it should draw through the geometry. In 3D those are different questions
     *  and one answer cannot serve both — a collider mesh baked from a surface
     *  z-fights along every edge when it is depth-tested against that same
     *  surface, so a depth-tested view is the honest one and a see-through view
     *  is the readable one. Only meaningful for a game filling the slot itself;
     *  the built-in 2D `world` path is drawn over the finished frame either way,
     *  and both stops look identical there. */
    collisionMode?: boolean | "xray";
    /** Initial mode. Default `"off"`. */
    initial?: DebugMode;
    /** Panels to draw while the overlay is visible, in order. More can be added
     *  later with `DebugApi.panel`. */
    panels?: readonly DebugPanel[];
    /** Called after the mode changes, including shortcut-driven changes. */
    onModeChange?(mode: DebugMode): void;
}
export interface DebugPlugin {
    readonly mode: DebugMode;
    cycle(): DebugMode;
    set3dRenderer(renderer: Perf3DSource | null): void;
    setNetMeter(meter: NetMeter | null): void;
    panel(draw: DebugPanel): () => void;
    drawPanels(app: App): void;
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
    /** Add a panel to the overlay. Returns a function that removes it again. */
    panel(draw: DebugPanel): () => void;
    /** Draw the panels NOW, and skip the automatic pass for this frame.
     *
     *  Panels are drawn from `onFrame`, which runs after `draw` — the right place
     *  for something that must sit on top of the finished frame. A game whose own
     *  draw ends with something that must sit on top of the PANELS, such as a UI
     *  kit's deferred tooltip pass, calls this at the point in its draw where the
     *  panels belong instead. Calling it more than once in a frame draws once. */
    drawPanels(app: App): void;
    watch(name: string, read: () => unknown): () => void;
    snapshot(): Record<string, unknown>;
    readonly entries: readonly Inspection[];
}
/** Draw collision geometry for a queryable world and optional movers.
 * Usually `createDebug(app)` calls this for you. */
export declare function collision(ctx: CanvasRenderingContext2D, world: DebugWorld, view: Rect, bodies?: Iterable<Rect | MoverBody>): void;
/** App-owned debug overlays and runtime inspection. */
export declare function createDebug(app: App, opts?: DebugOptions): DebugApi;
export * from "./inspector.js";
