import type { Pixels } from "./png.js";
export interface Rect {
    sx: number;
    sy: number;
    sw: number;
    sh: number;
}
export interface Insets {
    left: number;
    top: number;
    right: number;
    bottom: number;
}
/** One nine-slice frame to check, named for reporting. */
export interface RegionInput {
    name: string;
    rect: Rect;
    /** Omit to run in discovery mode: the analyser proposes insets instead. */
    insets?: Insets;
}
export interface Finding {
    level: "error" | "warning" | "info";
    region: string;
    code: string;
    message: string;
    /** Concrete corrected value, when one is derivable. */
    fix?: string;
}
export interface AxisReport {
    axis: "x" | "y";
    /** One character per column (x) or row (y); identical art shares a letter. */
    keys: string;
    /** Declared leading inset — `left` on x, `top` on y. */
    lead: number;
    trail: number;
    center: number;
    /** True repeat period of the declared centre band, in pixels. Equal to
     *  `center` when the band has no internal repeat at all. */
    period: number;
    /** Whether `period` is a real repeat rather than "the whole band". */
    periodic: boolean;
    /** Whether the art yielded a centre band to derive insets from. */
    derived: boolean;
    /** Insets implied by the art itself. */
    suggestedLead: number;
    suggestedTrail: number;
    /** Wrap discontinuity relative to the band's own internal variation. */
    seam: number;
    /** Every column/row where the composed edge changes phase, at `size`. */
    breaks: number[];
}
export interface RegionReport {
    name: string;
    rect: Rect;
    insets: Insets;
    suggested: Insets;
    x: AxisReport;
    y: AxisReport;
    findings: Finding[];
}
/** Intern each column (or row) of a rect so identical art shares an id. */
export declare function sliceIds(image: Pixels, rect: Rect, axis: "x" | "y"): number[];
/** Render interned ids as a one-character-per-pixel strip. */
export declare const idStrip: (ids: readonly number[]) => string;
/** Smallest repeat period of `ids[from, to)`, or the segment length when the
 *  segment does not repeat within itself.
 *
 *  A period is only believed when the segment holds two full cycles of it.
 *  Without that bar a 16px band whose last two columns happen to match its
 *  first two "has period 14" on two comparisons, and every such coincidence
 *  becomes a phantom slit report. */
export declare function bandPeriod(ids: readonly number[], from: number, to: number): number;
/** The longest periodic run in the middle of an axis, which is what the two
 *  outer insets have to exclude.
 *
 *  Two guards keep this from proposing nonsense insets. A run must be two full
 *  periods long, so an accidental pair of matching columns cannot pass as a
 *  repeat; and it must span the axis midpoint, because the centre band of a
 *  nine-slice is by definition the middle of the frame. Without the second
 *  guard, a long incidental repeat down at one end of a busy sprite gets
 *  proposed as the centre and the suggested insets come out absurd. */
export declare function longestPeriodicRun(ids: readonly number[]): {
    start: number;
    end: number;
    period: number;
} | undefined;
/** Tight bounding box of non-transparent pixels inside a rect, in rect-local
 *  coordinates. Undefined when the rect holds no opaque pixel at all. */
export declare function contentBounds(image: Pixels, rect: Rect): Rect | undefined;
/** Insets implied purely by the art, for a region that declares none. */
export declare function deriveInsets(image: Pixels, rect: Rect): Insets;
/** Check one nine-slice frame against its source art. */
export declare function analyzeRegion(image: Pixels, input: RegionInput): RegionReport;
/** Flag frames whose source rects overlap, which is nearly always a copy-paste
 *  slip in a hand-written atlas manifest. */
export declare function overlaps(regions: readonly RegionInput[]): Finding[];
/** Reproduce `drawNineSlice` (src/ui/core/theme.ts) on the CPU, including its
 *  clipped final tile and its scale-the-whole-frame fallback below the minimum
 *  size. Nearest-neighbour, because the renderer disables smoothing. */
export declare function compose(image: Pixels, rect: Rect, insets: Insets, w: number, h: number): Pixels;
/** Where a composed frame actually breaks phase. This is the empirical check:
 *  it reads the rendered result rather than the declaration, so it catches
 *  anything the geometry analysis above missed. */
export declare function phaseBreaks(image: Pixels, rect: Rect, insets: Insets, size: {
    w: number;
    h: number;
}): {
    top: number[];
    left: number[];
};
