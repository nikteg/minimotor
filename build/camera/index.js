import { createLens } from "./lens.js";
// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./lens.js";
/** Create the primary camera namespace for one explicit app. */
export function createCamera(app) {
    const base = {
        view: app.viewport,
        steps: () => app.Loop.steps,
        draw: app.Draw,
    };
    const lens = createLens(base);
    return {
        follow: lens.follow.bind(lens),
        render: lens.render.bind(lens),
        create(opts = {}) {
            return createLens({ ...base, ...opts });
        },
        layer: lens.layer.bind(lens),
        shake: lens.shake.bind(lens),
        snap: lens.snap.bind(lens),
        toWorld: lens.toWorld.bind(lens),
        toScreen: lens.toScreen.bind(lens),
        get x() {
            return lens.x;
        },
        set x(value) {
            lens.x = value;
        },
        get y() {
            return lens.y;
        },
        set y(value) {
            lens.y = value;
        },
        get zoom() {
            return lens.zoom;
        },
        set zoom(value) {
            lens.zoom = value;
        },
        get rect() {
            return lens.rect;
        },
    };
}
