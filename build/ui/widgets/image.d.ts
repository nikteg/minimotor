import { type Flowable } from "../../ui/core/index.js";
/** A canvas image drawn into an ordinary UI flow slot. */
export interface ImageOptions extends Flowable {
    /** Stable identity for layout capture and diagnostics. */
    id?: string;
    /** The decoded image source to draw. */
    source: CanvasImageSource;
    /** Crop to fill the slot, or letterbox to fit inside it. Default `cover`. */
    fit?: "cover" | "contain";
}
/** A focusable/clickable image, useful for profile thumbnails and avatars. */
export interface ImageButtonOptions extends Omit<ImageOptions, "source"> {
    /** The decoded image, or omitted for a neutral empty state. */
    source?: CanvasImageSource;
    /** Stable identity enables focus and layout diagnostics. */
    id?: string;
    /** Called when the image is pressed and released on itself. */
    onClick?: () => void;
    /** Drawn over the image while hovered, e.g. a pencil icon. */
    hoverIcon?: string;
    /** Text shown when no source has been accepted yet. */
    placeholder?: string;
    /** Held-hover explanation, like `button`'s. An image button is a control
     *  whose whole label is a picture, so it is the widget that most needs one:
     *  there is nothing else on it to say what pressing it does. */
    tooltip?: string;
}
/** Draw a decoded image as a UI widget. The source is intentionally supplied by
 * the caller: loading, validation and lifecycle belong to the app that owns the
 * asset, while this widget only handles layout and canvas painting. */
export declare function image(opts: ImageOptions): {
    x: number;
    y: number;
    w: number;
    h: number;
};
/** Draw an image as its own button. The image remains visible beneath the
 * hover treatment, so callers do not need to layer an opaque button over it. */
export declare function imageButton(opts: ImageButtonOptions): boolean;
