// ---------- Portal router implementation ----------
// Portals connect world areas; scenes remain presentation/lifecycle. Several
// areas may use one gameplay scene, or each area may name a different scene.
// The body carries its current `area`, which Net.share preserves and treats as
// a teleport boundary, so peers never interpolate through unloaded maps.
import { rectsOverlap } from "../collision/index.js";
import { fade, wipe } from "../transitions/index.js";
function defaultBounds(body) {
    if (typeof body.w === "number" && typeof body.h === "number")
        return body;
    return { x: body.x, y: body.y, w: 0.001, h: 0.001 };
}
function defaultPlace(body, spawn, destination) {
    body.x = spawn.x - (body.w ?? 0) / 2;
    // Feet markers describe the supporting surface. Leave one world pixel of
    // clearance so the next collision step establishes contact instead of
    // inheriting an edge-overlap from a teleport or replicated body.
    body.y = spawn.y - (destination.anchor === "feet" ? (body.h ?? 0) + 1 : (body.h ?? 0) / 2);
    if (typeof body.grounded === "boolean")
        body.grounded = false;
}
function stopBody(body) {
    if (body.vel)
        body.vel.x = body.vel.y = 0;
    if (typeof body.vx === "number")
        body.vx = 0;
    if (typeof body.vy === "number")
        body.vy = 0;
}
function authoredTransition(value, duration) {
    if (!value || value === "none")
        return undefined;
    if (typeof value !== "string")
        return value;
    const ms = duration ?? 400;
    if (value === "fade")
        return fade(ms);
    return wipe(ms, value.slice(5));
}
/** Create an area router. Detection runs automatically after fixed gameplay
 * updates. `LDtk.world` supplies authored `mm:portal` destinations and
 * transitions directly. A portal disarms until the body leaves every
 * destination trigger, preventing paired doors from bouncing straight back. */
export function createPortalRouter(options) {
    const read = typeof options.body === "function" ? options.body : () => options.body;
    const bounds = options.bounds ?? defaultBounds;
    const place = options.place ?? defaultPlace;
    let armed = true;
    function area(id) {
        const explicit = options.areas?.[id];
        if (explicit)
            return explicit;
        if (!options.world)
            throw new Error("Portals: pass areas or world");
        const scene = typeof options.scene === "function"
            ? options.scene(id)
            : (options.scene ?? id);
        return {
            scene,
            level: options.world.level(id),
            portals: options.world.portals(id),
            resolve: options.world.resolve,
        };
    }
    function travel(destination, portal) {
        const body = read();
        const from = body.area;
        const target = area(destination.area);
        const spawn = target.resolve?.(destination) ?? target.level.spawnOne(destination.spawn);
        const detail = {
            from,
            to: destination.area,
            spawn: destination.spawn,
            portal,
        };
        const swap = () => {
            body.area = destination.area;
            place(body, spawn, destination);
            stopBody(body);
            armed = false;
            options.onTravel?.(detail);
        };
        const transition = portal?.transition !== undefined
            ? authoredTransition(portal.transition, portal.transitionMs)
            : options.transition;
        options.scenes.go(target.scene, {
            transition,
            beforeCover: () => options.beforeTravel?.(detail),
            onSwap: swap,
            afterReveal: () => options.afterTravel?.(detail),
        });
    }
    let unsubscribe;
    const router = {
        get area() {
            return read().area;
        },
        update() {
            const body = read();
            const current = area(body.area);
            // A modal/title scene may keep drawing the area below it, but only the
            // area's own gameplay scene may activate its portals.
            if (options.scenes.active !== current.scene)
                return false;
            const portals = current.portals;
            const box = bounds(body);
            const touching = portals.find((portal) => rectsOverlap(box, portal));
            if (!armed) {
                if (!touching)
                    armed = true;
                return false;
            }
            if (!touching)
                return false;
            travel(touching.to, touching);
            return true;
        },
        travel(destination) {
            travel(destination);
        },
        sameArea(other) {
            return other.area === read().area;
        },
        dispose() {
            unsubscribe?.();
            unsubscribe = undefined;
        },
    };
    if (options.auto !== false) {
        if (!options.app) {
            throw new Error("Portals: automatic routing requires createPortals(app)");
        }
        // `onStep`, not a per-frame hook: the router must advance exactly once per
        // fixed step, so a catch-up frame routes every step it simulates.
        unsubscribe = options.app.onStep(() => router.update());
        options.app.onDestroy(() => router.dispose());
    }
    return router;
}
