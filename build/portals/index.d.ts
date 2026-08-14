import type { App } from "../engine/index.js";
import { type PortalBody, type PortalOptions } from "./router.js";
export * from "./router.js";
/** Portal factory whose automatic updates belong to one app lifecycle. */
export declare function createPortals(app: App): {
    create<A extends string, S extends string, B extends PortalBody<A>>(options: PortalOptions<A, S, B>): import("./router.js").PortalRouter<A>;
};
