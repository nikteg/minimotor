import type { App } from "@src/engine/index.js";
import { createPortalRouter, type PortalBody, type PortalOptions } from "./router.js";

// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./router.js";

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
