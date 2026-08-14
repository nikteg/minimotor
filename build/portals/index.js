import { createPortalRouter } from "./router.js";
// The subpath entry: the app-bound factory plus the pure module it binds.
export * from "./router.js";
/** Portal factory whose automatic updates belong to one app lifecycle. */
export function createPortals(app) {
    return {
        create(options) {
            return createPortalRouter({ ...options, app });
        },
    };
}
