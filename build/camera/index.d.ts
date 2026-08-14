import type { App } from "../engine/index.js";
import { type CameraApi } from "./lens.js";
export * from "./lens.js";
/** Create the primary camera namespace for one explicit app. */
export declare function createCamera(app: App): CameraApi;
