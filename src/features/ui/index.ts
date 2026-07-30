// ---------- UI ----------
// Immediate-mode UI: buttons, panels, lists, tables, dialogs, drag-and-drop.
// Widgets are drawn and polled every frame from their options — no retained
// widget tree, no event handlers to wire up.
//
//   const UI = createUI(app);
//   if (UI.button("Play", { x: 300, y: 200 })) start();
//   UI.panel({ x: 20, y: 20, w: 200, h: 120, title: "Inventory" });

import { animate as animateValue, type AnimateOptions, type Motion } from "../../anim/value.js";
import type { App } from "../../engine/app.js";
import type { InputApi } from "../input/index.js";
import * as UiModule from "./api.js";
import { runtimeFor, withRuntime } from "./core/runtime.js";

// Widget functions are implementation details: the public functions returned
// by createUI are permanently bound to one app/runtime. Exporting the raw
// functions made it possible to call UI without an app and fail in uiCtx().
export type * from "./api.js";

type UiModuleApi = Omit<typeof UiModule, "begin" | "_reset" | "animate">;
export type UiApi = UiModuleApi & {
  animate(options: Omit<AnimateOptions, "clock">): Motion;
};

/** UI API isolated to one canvas and bound to its interface clock. */
export function createUI(app: App, input?: Pick<InputApi, "gamepads">): UiApi {
  const runtime = runtimeFor(app.ctx);
  runtime.gamepads = input?.gamepads ?? (() => []);
  const api: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(UiModule)) {
    if (key === "begin" || key === "_reset" || key === "animate") continue;
    const value = Reflect.get(UiModule, key);
    api[key] =
      typeof value === "function"
        ? (...args: unknown[]) => withRuntime(runtime, () => value(...args))
        : value;
  }
  api.animate = (options: Omit<AnimateOptions, "clock">) =>
    animateValue({ ...options, clock: app.Clock.ui });
  return api as UiApi;
}
