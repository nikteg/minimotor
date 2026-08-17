// ---------- UI ----------
// Immediate-mode UI: buttons, panels, lists, tables, dialogs, drag-and-drop.
// Widgets are drawn and polled every frame from their options — no retained
// widget tree, no event handlers to wire up.
//
//   const UI = createUI(app);
//   if (UI.button("Play", { x: 300, y: 200 })) start();
//   UI.panel({ x: 20, y: 20, w: 200, h: 120, title: "Inventory" });

import { animate as animateValue, type AnimateOptions, type Motion } from "@src/anim/value.js";
import type { App } from "@src/engine/app.js";
import type { InputApi } from "@src/input/index.js";
import * as UiModule from "./api.js";
import { registerUiApp, withUiApp } from "./core/state.js";

// Widget functions are implementation details: the public functions returned
// by createUI are permanently bound to one app. Exporting the raw
// functions made it possible to call UI without an app and fail in uiCtx().
export type * from "./api.js";
export {
  createTilesetSkin,
  createTilesetSkinFromManifest,
  frameFromCell,
  inspectTilesetSkin,
} from "./api.js";

type UiModuleApi = Omit<
  typeof UiModule,
  | "_reset"
  | "animate"
  | "createTilesetSkin"
  | "createTilesetSkinFromManifest"
  | "drawThemeSprite"
  | "frameFromCell"
  | "inspectTilesetSkin"
>;
export type UiApi = UiModuleApi & {
  animate(options: Omit<AnimateOptions, "clock">): Motion;
};

/** UI API isolated to one canvas and bound to its interface clock. */
export function createUI(app: App, { gamepads }: Partial<Pick<InputApi, "gamepads">> = {}): UiApi {
  registerUiApp(app, gamepads);
  const bind = <F extends (...args: never[]) => unknown>(fn: F): F =>
    ((...args: Parameters<F>) => withUiApp(app, () => fn(...args))) as F;
  return {
    bar: bind(UiModule.bar),
    blur: bind(UiModule.blur),
    button: bind(UiModule.button),
    buttonState: bind(UiModule.buttonState),
    captureOverlay: bind(UiModule.captureOverlay),
    buttonWidth: bind(UiModule.buttonWidth),
    cancelDrag: bind(UiModule.cancelDrag),
    clearFloatText: bind(UiModule.clearFloatText),
    clip: bind(UiModule.clip),
    col: bind(UiModule.col),
    confirm: bind(UiModule.confirm),
    createFloatText: bind(UiModule.createFloatText),
    dialog: bind(UiModule.dialog),
    dragScroll: bind(UiModule.dragScroll),
    dragGesture: bind(UiModule.dragGesture),
    dragSource: bind(UiModule.dragSource),
    draggedItem: bind(UiModule.draggedItem),
    drawFloatText: bind(UiModule.drawFloatText),
    drawLayoutOverlay: bind(UiModule.drawLayoutOverlay),
    drawTips: bind(UiModule.drawTips),
    dropIndicator: bind(UiModule.dropIndicator),
    dropTarget: bind(UiModule.dropTarget),
    dropTargetState: bind(UiModule.dropTargetState),
    field: bind(UiModule.field),
    floatText: bind(UiModule.floatText),
    flow: bind(UiModule.flow),
    focus: bind(UiModule.focus),
    focusedId: bind(UiModule.focusedId),
    focusNext: bind(UiModule.focusNext),
    focusPrevious: bind(UiModule.focusPrevious),
    fromScreen: bind(UiModule.fromScreen),
    getTheme: bind(UiModule.getTheme),
    grid: bind(UiModule.grid),
    height: bind(UiModule.height),
    idScope: bind(UiModule.idScope),
    ids: bind(UiModule.ids),
    image: bind(UiModule.image),
    imageButton: bind(UiModule.imageButton),
    lastRect: bind(UiModule.lastRect),
    layoutCapture: bind(UiModule.layoutCapture),
    layoutIssues: bind(UiModule.layoutIssues),
    layoutLag: bind(UiModule.layoutLag),
    layoutTree: bind(UiModule.layoutTree),
    list: bind(UiModule.list),
    listItem: bind(UiModule.listItem),
    measureWidth: bind(UiModule.measureWidth),
    minimap: bind(UiModule.minimap),
    modal: bind(UiModule.modal),
    paintIssues: bind(UiModule.paintIssues),
    panel: bind(UiModule.panel),
    pointerOverUi: bind(UiModule.pointerOverUi),
    pressOrigin: bind(UiModule.pressOrigin),
    popover: bind(UiModule.popover),
    row: bind(UiModule.row),
    scaled: bind(UiModule.scaled),
    scrollbar: bind(UiModule.scrollbar),
    scrollbarFade: bind(UiModule.scrollbarFade),
    wheelScroll: bind(UiModule.wheelScroll),
    dismissedByOutsideRelease: bind(UiModule.dismissedByOutsideRelease),
    scrollGestureActive: bind(UiModule.scrollGestureActive),
    select: bind(UiModule.select),
    setBaseSize: bind(UiModule.setBaseSize),
    setCursor: bind(UiModule.setCursor),
    setNavPad: bind(UiModule.setNavPad),
    setScale: bind(UiModule.setScale),
    setTheme: bind(UiModule.setTheme),
    withTheme: bind(UiModule.withTheme),
    slider: bind(UiModule.slider),
    spacer: bind(UiModule.spacer),
    spinner: bind(UiModule.spinner),
    table: bind(UiModule.table),
    tabs: bind(UiModule.tabs),
    text: bind(UiModule.text),
    textInput: bind(UiModule.textInput),
    textMetrics: bind(UiModule.textMetrics),
    textWidth: bind(UiModule.textWidth),
    toScreen: bind(UiModule.toScreen),
    toggle: bind(UiModule.toggle),
    tooltip: bind(UiModule.tooltip),
    vh: bind(UiModule.vh),
    viewport3d: bind(UiModule.viewport3d),
    vw: bind(UiModule.vw),
    width: bind(UiModule.width),
    worldLabel: bind(UiModule.worldLabel),
    defaultTheme: UiModule.defaultTheme,
    animate: (options) => animateValue({ ...options, clock: app.Clock.ui }),
  };
}
