import type { App } from "@src/engine/index.js";
import { createLens, type CameraApi, type CameraOptions } from "./lens.js";

// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./lens.js";

/** Create the primary camera namespace for one explicit app. */
export function createCamera(app: App): CameraApi {
  const base = {
    view: app.viewport,
    steps: () => app.Loop.steps,
    draw: app.Draw as CameraOptions["draw"],
  };
  const lens = createLens(base);
  return {
    follow: lens.follow.bind(lens),
    render: lens.render.bind(lens),
    create(opts: Omit<CameraOptions, "view" | "steps" | "draw"> = {}) {
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
    set x(value: number) {
      lens.x = value;
    },
    get y() {
      return lens.y;
    },
    set y(value: number) {
      lens.y = value;
    },
    get zoom() {
      return lens.zoom;
    },
    set zoom(value: number) {
      lens.zoom = value;
    },
    get rect() {
      return lens.rect;
    },
  };
}
