import { LayoutChildren, LayoutOptions } from "../../ui/core/index.js";
/** Lay children out left-to-right. Root call needs an explicit rect; nested
 *  calls reserve a slot from the enclosing container (full parent height, a
 *  declared width, or `h` as the row's own height in a column parent). The
 *  callback receives the cursor and returns whatever you return — a nested
 *  button's `clicked` bubbles straight out:
 *
 *    UI.row(() => {
 *      if (UI.button({ label: "Play" })) start();   // auto-flows, auto-width
 *      UI.button({ label: "Options" });
 *    }); */
export declare function row<R>(children: LayoutChildren<R>): R;
export declare function row<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
/** Lay children out top-to-bottom. See `row`. */
export declare function col<R>(children: LayoutChildren<R>): R;
export declare function col<R>(opts: LayoutOptions, children: LayoutChildren<R>): R;
/** A bordered/optionally-titled box that also LAYS OUT its children (a column by
 *  default, a row via `dir`) — the framed container. */
export interface PanelOptions<T = unknown> extends LayoutOptions {
    /** Optional title, drawn in the frame's title strip. */
    title?: string;
    /** Body layout axis. Default `"col"`. */
    dir?: "row" | "col";
    /** Frame fill color. Default `theme.panel.background`. */
    bg?: string;
    /** Frame border color. Default `theme.border`. */
    border?: string;
    /** Ring stroked over the finished frame — the way to mark a container live
     *  (a drop target, a validation error) under a pixel skin, whose nine-slice
     *  art replaces `border`. Omit for none. */
    highlight?: string;
    /** Register a drop target over the panel's resolved frame. The state is
     *  available to children through `dropTargetState(id)`. */
    dropTarget?: {
        id: string;
        accepts?: (payload: T, sourceId: string) => boolean;
    };
}
/** A framed, optionally-titled box that lays its children out — the workhorse
 *  container for menus, dialogs and HUD clusters (`panel` + `col`/`row` in one).
 *  The body is inset below the title strip and padded by `theme.panel.padding`; a bare
 *  frame is just `UI.panel(opts, () => {})` positioning content absolutely
 *  inside. `title`/`bg`/`border` style the frame; the rest is `LayoutOptions`
 *  (`justify`/`anchor`/`overflow`/`dir`/nesting):
 *
 *    UI.panel({ anchor: "center", w: 260, title: "PAUSED" }, () => {
 *      if (UI.button({ label: "Resume" })) resume();
 *    }); */
export declare function panel<R, T = unknown>(opts: PanelOptions<T>, children: LayoutChildren<R>): R;
/** Insert extra spacing before the next child in the current layout. */
export declare function spacer(px: number): void;
/** Clip drawing to `rect` for the duration of `children` — for scrollable
 *  lists and masked regions, so a screen never hand-rolls save/clip/restore.
 *  Also gates the pointer to `rect`, so a widget clipped out of view (e.g.
 *  scrolled past a region's edge) can't be clicked through the empty space it
 *  was drawn into. Returns the callback's value. */
export declare function clip<R>(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, children: () => R): R;
/** Options for the fit form of `scaled`: a reference size the UI is laid out in,
 *  uniformly scaled and positioned to fit the current UI space. */
export interface ScaledOptions {
    /** Reference width — position/size widgets as if the space were this wide. */
    w: number;
    /** Reference height (see `w`). */
    h: number;
    /** Extra multiplier on the fit scale — a UI-scale knob (accessibility /
     *  preference). Default 1. */
    scale?: number;
    /** Where the scaled box sits. Default "center"; "top-left" pins it to origin. */
    align?: "center" | "top-left";
}
/** Scale a UI region — the draw AND the pointer, so hit-testing stays correct;
 *  nests; returns the callback's value. Three forms:
 *  - `UI.scaled(() => …)` — the global settings: fit the reference size
 *    (`UI.setBaseSize`) into the viewport if one is set, times `UI.setScale`.
 *    With no base size it's just the `UI.setScale` factor (a no-op at 1).
 *  - `UI.scaled({ w, h, scale?, align? }, () => …)` — fit an explicit w×h
 *    reference box (forces the aspect ratio, keeps sizing consistent).
 *  - `UI.scaled(factor, () => …)` — a raw uniform multiplier.
 *  Inside, lay out with `row`/`col`/absolute coords in reference units; read the
 *  space with `UI.width`/`UI.height`.
 *
 *    UI.setBaseSize({ w: 1280, h: 720 });     // once
 *    UI.scaled(() => { if (UI.button({ x: 40, y: 40, label: "PLAY" })) start(); }); */
export declare function scaled<R>(children: () => R): R;
export declare function scaled<R>(factor: number, children: () => R): R;
export declare function scaled<R>(opts: ScaledOptions, children: () => R): R;
