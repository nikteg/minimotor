import type { Finding, Insets, Rect, RegionReport } from "./analyze.js";
import type { Pixels } from "./png.js";
/** Sort findings by severity, keeping declaration order inside a level. */
export declare const rank: (findings: readonly Finding[]) => Finding[];
/** One region as text: geometry, both axes, then its findings. */
export declare function formatRegion(report: RegionReport): string;
/** A one-character-per-pixel map of the region, banded by the insets. Only
 *  worth printing for small frames; big ones say nothing a strip does not. */
export declare function pixelMap(image: Pixels, rect: Rect, insets: Insets): string | undefined;
/** The source frame, zoomed, with the four inset cuts drawn across it. */
export declare function annotate(image: Pixels, rect: Rect, insets: Insets, zoom?: number): Pixels;
/** A contact sheet of the frame composed at sizes chosen to expose wrap bugs:
 *  the minimum, an exact multiple of the centre band, and two sizes that land
 *  mid-tile so the clipped final repeat is visible. */
export declare function previewSheet(image: Pixels, rect: Rect, insets: Insets, zoom?: number): Pixels;
