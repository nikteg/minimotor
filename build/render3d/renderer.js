// ---------- Renderer interface ----------
// The seam between "a scene" and "a GPU". Two backends implement it — WebGL2
// and WebGPU — and the rest of the engine never learns which one it has.
//
// A renderer OWNS ITS OWN CANVAS and draws the whole of it. That one decision
// is what lets the same object serve both uses:
//
//   - a full-screen scene layer, sized to the viewport and stacked UNDER the
//     app's 2D canvas, composited by the browser with no readback;
//   - a viewport inside the UI, sized to a widget's rect and blitted into the
//     UI's 2D context, so it clips, scrolls and z-orders like any other widget.
//
// The second costs one `drawImage` of a small canvas per frame. That is a real
// cost and the reason the plan rules it out for a FULL-SCREEN scene — but for
// a 200×200 panel it is far cheaper than the alternative (hole-punching the UI
// and fighting the compositor for z-order), and it is the only way a 3D view
// can sit correctly under a modal.
export {};
