/** Request a tooltip for this frame (call while your hit-area is hovered —
 *  widgets with a `tooltip` option do this for you). Drawn by `drawTips`
 *  after the hover has held ~350 ms — at the UI scale of the widget that asked,
 *  so a tip on a zoomed board matches the board. */
export declare function tooltip(msg: string): void;
/** Draw the pending tooltip near the pointer, clamped to the viewport. Call
 *  LAST in draw (after `drawFloatText`, after any modal) so it sits on top. */
export declare function drawTips(): void;
