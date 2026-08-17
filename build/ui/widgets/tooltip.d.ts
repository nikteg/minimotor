/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms — at the UI scale of the widget that asked,
 *  so a tip on a zoomed board matches the board. */
export declare function tooltip(msg: string): void;
/** Ask for a tooltip only while the pointer is inside `rect`.
 *
 *  `tooltip` itself is unconditional — a widget calls it having already decided
 *  it is hovered. This is for PAINTED content, which has no widget to decide
 *  that for it: a chip drawn straight onto the surface, an icon in a reserved
 *  slot, a cell a table filled by hand. Without it the only way to explain such
 *  a thing is to put a real control under it, which then takes hover and focus
 *  and does nothing with either.
 *
 *  Respects the overlay rules the same way every widget does, because it reads
 *  the same pointer: painted content under an open modal is not hovered. */
export declare function tooltipFor(rect: {
    x: number;
    y: number;
    w: number;
    h: number;
}, msg: string): void;
/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export declare function drawTips(): void;
