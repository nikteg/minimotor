// ---------- Debug overlay ----------
// One opt-in plugin owns the common development HUD progression:
//   none → performance → performance + world collision → none,
// with an optional fourth stop that draws the collision through the geometry
// (`collisionMode: "xray"`).
import { createInspector } from "./inspector.js";
import { plugin as perfPlugin } from "../perf/index.js";
const allModes = ["off", "performance", "collision", "collision-xray"];
function drawSolid(ctx, solid) {
    ctx.beginPath();
    if (solid.slope === "up-right") {
        ctx.moveTo(solid.x, solid.y + solid.h);
        ctx.lineTo(solid.x + solid.w, solid.y);
        ctx.lineTo(solid.x + solid.w, solid.y + solid.h);
        ctx.closePath();
    }
    else if (solid.slope === "up-left") {
        ctx.moveTo(solid.x, solid.y);
        ctx.lineTo(solid.x + solid.w, solid.y + solid.h);
        ctx.lineTo(solid.x, solid.y + solid.h);
        ctx.closePath();
    }
    else if (solid.oneWay) {
        ctx.moveTo(solid.x, solid.y);
        ctx.lineTo(solid.x + solid.w, solid.y);
    }
    else {
        ctx.rect(solid.x, solid.y, solid.w, solid.h);
    }
    ctx.fillStyle = solid.oneWay ? "rgba(255, 210, 80, .14)" : "rgba(60, 220, 255, .12)";
    if (!solid.oneWay || solid.slope)
        ctx.fill();
    ctx.strokeStyle = solid.oneWay ? "#ffd250" : "#3cdcff";
    ctx.stroke();
}
/** Draw collision geometry for a queryable world and optional movers.
 * Usually `createDebug(app)` calls this for you. */
export function collision(ctx, world, view, bodies = []) {
    const solids = [];
    world.solidsNear(view, solids);
    for (const solid of solids)
        drawSolid(ctx, solid);
    if (world.laddersNear) {
        const ladders = [];
        world.laddersNear(view, ladders);
        ctx.strokeStyle = "#7dff83";
        ctx.setLineDash([2, 2]);
        for (const ladder of ladders)
            ctx.strokeRect(ladder.x, ladder.y, ladder.w, ladder.h);
        ctx.setLineDash([]);
    }
    ctx.strokeStyle = "#ff5ad9";
    for (const body of bodies)
        ctx.strokeRect(body.x, body.y, body.w, body.h);
}
/** Install the `?`/four-finger debug cycle. `KeyboardEvent.key` is used
 * deliberately, so both US Shift+/ and Swedish Shift+Plus produce the same
 * shortcut. Native UI inputs keep the key and never cycle the game overlay.
 * Four simultaneous touch pointers provide the same shortcut on iPad/iPhone. */
function debugPlugin(app, opts) {
    const perf = opts.perf === false ? null : perfPlugin(opts.perf);
    const camera = opts.camera;
    let render3d = null;
    // The x-ray stop is opt-in rather than automatic: it only tells a 3D game's
    // collision view anything, and a cycle with a stop that looks exactly like
    // the one before it is worse than a cycle without it.
    const modes = (opts.world && camera) || opts.collisionMode
        ? opts.collisionMode === "xray"
            ? allModes
            : allModes.slice(0, 3)
        : allModes.slice(0, 2);
    const requestedInitial = opts.initial ?? "off";
    const initialIndex = modes.indexOf(requestedInitial);
    let index = initialIndex >= 0 ? initialIndex : modes.indexOf("performance");
    let shortcutDown = false;
    const panels = [...(opts.panels ?? [])];
    // Set by `drawPanels` and cleared by the automatic pass, so a game that draws
    // its panels itself gets them once rather than twice. The two calls are
    // ordered by the frame itself — `drawPanels` happens inside `draw`, the
    // automatic pass in the `onFrame` that follows it — so one flag is enough
    // and no frame counter is needed.
    let panelsDrawn = false;
    const touchPointers = new Set();
    let touchCycleFired = false;
    let firstTouchAt = Number.NEGATIVE_INFINITY;
    const cycle = () => {
        index = (index + 1) % modes.length;
        const mode = modes[index];
        opts.onModeChange?.(mode);
        return mode;
    };
    // Pointer events preserve one pointerId per finger even though the app's
    // public Pointer state intentionally collapses gameplay input to one point.
    // Keep this gesture private to the debug layer so normal game/UI input does
    // not acquire multi-touch semantics just for a developer shortcut.
    const onTouchPointerDown = (event) => {
        if (event.pointerType !== "touch")
            return;
        const now = performance.now();
        if (touchPointers.size === 0)
            firstTouchAt = now;
        touchPointers.add(event.pointerId);
        if (touchPointers.size >= 4 && now - firstTouchAt <= 500 && !touchCycleFired) {
            touchCycleFired = true;
            cycle();
        }
    };
    const onTouchPointerEnd = (event) => {
        if (event.pointerType !== "touch")
            return;
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
        panel(draw) {
            panels.push(draw);
            return () => {
                const at = panels.indexOf(draw);
                if (at >= 0)
                    panels.splice(at, 1);
            };
        },
        drawPanels(app) {
            if (panelsDrawn || modes[index] === "off")
                return;
            panelsDrawn = true;
            for (const draw of panels)
                draw(app, modes[index]);
        },
        frame(app) {
            // The shortcut is edge-detected here rather than in a fixed step so it
            // still works while the loop is paused — `onFrame` runs on paused frames.
            const down = app.Keys.keyDown("?");
            if (down && !shortcutDown)
                cycle();
            shortcutDown = down;
            // Both collision stops, because this overlay paints over the finished
            // frame and has no depth to test against — see `collisionMode`.
            if (modes[index].startsWith("collision") && opts.world && camera) {
                const world = typeof opts.world === "function" ? opts.world() : opts.world;
                const view = camera.rect;
                app.ctx.save();
                camera.render(() => {
                    app.ctx.lineWidth = 1 / Math.max(camera.zoom, 0.0001);
                    collision(app.ctx, world, view, opts.bodies?.());
                });
                app.ctx.restore();
            }
            if (modes[index] !== "off") {
                perf?.frame(app);
                // After the HUD, so a panel can sit under it rather than fight it, and
                // only if the game did not already ask for them during its own draw.
                if (!panelsDrawn)
                    for (const draw of panels)
                        draw(app, modes[index]);
                panelsDrawn = false;
            }
            else {
                panelsDrawn = false;
                // Keep renderer-owned counters bounded while the debug overlay is
                // hidden. The next visible frame should describe that frame, not the
                // entire time spent with the overlay disabled.
                render3d?.consumeFrameStats();
            }
        },
    };
}
/** App-owned debug overlays and runtime inspection. */
export function createDebug(app, opts = {}) {
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
        panel: (draw) => plugin.panel(draw),
        drawPanels: (target) => plugin.drawPanels(target),
        watch: inspector.watch,
        snapshot: inspector.snapshot,
        get entries() {
            return inspector.entries;
        },
    };
}
export * from "./inspector.js";
