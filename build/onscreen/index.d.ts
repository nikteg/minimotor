import { type OnscreenGamepadConfig, type OnscreenPad } from "./controls.js";
import type { InputApi } from "../input/index.js";
import type { App } from "../engine/app.js";
import type { UiApi } from "../ui/index.js";
export interface OnscreenInputApi {
    gamepad(config?: OnscreenGamepadConfig): OnscreenPad;
    drawControls(pad: OnscreenPad): void;
    visible(pad: OnscreenPad): boolean;
    destroy(): void;
}
/** Create virtual controls bound explicitly to one app and input instance. */
export declare function createOnscreenInput(app: App, input: InputApi, ui: Pick<UiApi, "getTheme">): OnscreenInputApi;
export type { OnscreenGamepadConfig, OnscreenPad };
export * from "./controls.js";
