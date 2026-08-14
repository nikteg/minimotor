import { type AnimateOptions, type Motion } from "../anim/value.js";
import type { App } from "../engine/app.js";
import type { InputApi } from "../input/index.js";
import * as UiModule from "./api.js";
export type * from "./api.js";
export { createTilesetSkin, createTilesetSkinFromManifest, frameFromCell, inspectTilesetSkin, } from "./api.js";
type UiModuleApi = Omit<typeof UiModule, "_reset" | "animate" | "createTilesetSkin" | "createTilesetSkinFromManifest" | "drawThemeSprite" | "frameFromCell" | "inspectTilesetSkin">;
export type UiApi = UiModuleApi & {
    animate(options: Omit<AnimateOptions, "clock">): Motion;
};
/** UI API isolated to one canvas and bound to its interface clock. */
export declare function createUI(app: App, { gamepads }?: Partial<Pick<InputApi, "gamepads">>): UiApi;
