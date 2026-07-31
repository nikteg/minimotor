import type { App } from "../engine/index.js";
import { createPortalRouter, type PortalBody, type PortalOptions } from "./index.js";

// The subpath entry: the app-bound service plus the pure module it binds.
export * from "./index.js";

/** Portal factory whose automatic updates belong to one app lifecycle. */
export function createPortals(app: App) {
  return {
    create<A extends string, S extends string, B extends PortalBody<A>>(
      options: PortalOptions<A, S, B>,
    ) {
      return createPortalRouter({ ...options, app });
    },
  };
}
